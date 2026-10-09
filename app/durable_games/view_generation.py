"""Bounded post-commit projection generation; immutable inputs, fenced retries."""
import asyncio
from dataclasses import dataclass
from uuid import UUID, uuid4

from fastapi.encoders import jsonable_encoder
from psycopg.types.json import Jsonb

from .delivery import _join_cleanup
from .inbox import LaneTarget, PostgresInboxStore
from .queries import _ProjectionHost, _Profiles
from .recovery import rebuild_hosted_game
from .view_delta import DeltaError, make_delta, view_checksum


def view_scope(table):
    return f'view:{UUID(str(table))}'


def _projection(checkpoint, names, round_summary_seconds=8):
    host = _ProjectionHost(None, None, round_summary_seconds=round_summary_seconds)
    data = checkpoint['data']
    game = rebuild_hosted_game(host, checkpoint, receipt_snapshot=dict(match_id=data['match_id'],
        revision=data['engine']['revision'] if data['engine'] else 0,
        receipt_count=0, receipt_limit=10000, receipts=[])).game
    host.tables.setdefault(game.room_id, {})[game.match_id] = game
    host.profiles = _Profiles(names)
    return host, game


def _view(host, game, checkpoint, actor):
    snapshot = jsonable_encoder(host._snapshot(game, actor))
    snapshot.pop('tables', None)  # Room catalogs have their own invalidation lane.
    snapshot.update(table_id=game.table.table_id, table_revision=checkpoint['data']['table_revision'],
                    durable_game_id=str(game.durable_game_id) if game.durable_game_id else None)
    return snapshot


def projected_view(checkpoint, actor, names, round_summary_seconds=8):
    return _view(*_projection(checkpoint, names, round_summary_seconds), checkpoint, actor)


@dataclass(frozen=True)
class GenerationClaim:
    table_id: UUID
    revision: int
    base_revision: int
    token: UUID
    before: dict
    after: dict


class ViewGenerationWorker:
    def __init__(self, pool, presence, *, workers=4, timeout=8, lease_seconds=30,
                 interval=.1, max_recipients=512):
        if not 1 <= workers <= 16 or not 1 <= max_recipients <= 512 or timeout <= 0 or lease_seconds <= timeout * 2 or interval <= 0:
            raise ValueError('Invalid view generation bounds.')
        self.pool, self.presence = pool, presence
        self.workers, self.timeout, self.lease_seconds = workers, timeout, lease_seconds
        self.interval, self.max_recipients = interval, max_recipients
        self._task = None
        self._closed = False
        self._lock = asyncio.Lock()
        self.failures = 0

    async def claim(self):
        token = uuid4()
        async with self.pool.connection() as c:
            async with c.transaction():
                rows = await (await c.execute('''WITH picked AS (
                    SELECT j.table_id,j.revision FROM view_generation_jobs j
                    WHERE j.status='pending' AND j.next_attempt_at<=clock_timestamp()
                    AND (j.claim_expires_at IS NULL OR j.claim_expires_at<=clock_timestamp())
                    AND NOT EXISTS (SELECT 1 FROM view_generation_jobs earlier
                        WHERE earlier.table_id=j.table_id AND earlier.status='pending' AND earlier.revision<j.revision)
                    ORDER BY j.next_attempt_at,j.table_id LIMIT %s FOR UPDATE SKIP LOCKED
                ), claimed AS (
                    UPDATE view_generation_jobs j SET claim_token=%s,
                        claim_expires_at=clock_timestamp()+(%s*interval '1 second'),attempts=j.attempts+1
                    FROM picked p WHERE j.table_id=p.table_id AND j.revision=p.revision
                    RETURNING j.table_id,j.revision,j.base_revision,j.claim_token
                ) SELECT j.*,b.checkpoint AS before_checkpoint,a.checkpoint AS after_checkpoint FROM claimed j
                    JOIN delivery_checkpoints b ON b.table_id=j.table_id AND b.revision=j.base_revision
                    JOIN delivery_checkpoints a ON a.table_id=j.table_id AND a.revision=j.revision''',
                    (self.workers, token, self.lease_seconds))).fetchall()
        return tuple(GenerationClaim(*r) for r in rows)

    async def generate(self, claim):
        data = claim.after['data']
        observed = await self.presence.observe('room', view_scope(claim.table_id))
        if observed.status != 'observed':
            raise RuntimeError('View subscriber presence unavailable.')
        actors = sorted({p.user_id for p in observed.connections})
        if not actors:
            return []  # Offline players reconcile from snapshots when they join.
        if len(actors) > self.max_recipients:
            raise RuntimeError('Too many view recipients.')
        from .checkpoint_store import user_uuid
        async with self.pool.connection() as c:
            table = await (await c.execute('''SELECT t.created_at,r.creator_id FROM room_tables t
                JOIN rooms r ON r.id=t.room_id WHERE t.room_id=%s AND t.table_id=%s''',
                (data['room_id'], claim.table_id))).fetchone()
            if table is None:
                raise RuntimeError('View table metadata unavailable.')
            created_at = int(table[0].timestamp() * 1000)
            members = await (await c.execute('''SELECT user_id FROM room_memberships
                WHERE room_id=%s AND user_id=ANY(%s::uuid[])
                AND NOT EXISTS(SELECT 1 FROM deleted_rooms WHERE id=%s)''',
                (data['room_id'], [user_uuid(a) for a in actors], data['room_id']))).fetchall() if actors else []
            users = set(claim.before['data']['host']['users']) | set(data['host']['users'])
            users.discard(None)
            names = await (await c.execute('''SELECT u.id,COALESCE(NULLIF(p.display_name,''),a.username)
                FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
                LEFT JOIN account_credentials a ON a.user_id=u.id WHERE u.id=ANY(%s::uuid[])''',
                ([user_uuid(u) for u in sorted(users)],))).fetchall() if users else []
        names = {f'user-{u}': n for u, n in names}
        # Rebuild each immutable engine once, then project recipients using its
        # established authorized-view helpers. Never replay rules per recipient.
        before_host, before_game = _projection(claim.before, names)
        after_host, after_game = _projection(claim.after, names)
        messages = []
        for (user,) in members:
            # Let cancellation/deadlines run between bounded recipient builds.
            await asyncio.sleep(0)
            actor = f'user-{user}'
            reset = dict(type='VIEW_RESET', table_id=str(claim.table_id), revision=claim.revision)
            try:
                if claim.before['data']['match_id'] != data['match_id']:
                    raise DeltaError('Match replacement requires a snapshot.')
                before = _view(before_host, before_game, claim.before, actor)
                after = _view(after_host, after_game, claim.after, actor)
                delta = make_delta(before, after, game_id=data['match_id'],
                    base_revision=claim.base_revision, revision=claim.revision)
                previews = after_host.table_previews(after_game.room_id, actor)
                can_end = bool(after_game.finished and
                    (table[1] == user or after_game.users and actor == after_game.users[0]))
                preview = next((p for p in previews if p['match_id']==after_game.match_id
                    and p['status'] != 'ended' and p['phase'] != 'ENDED'
                    and (p['status'] != 'finished' and p['phase'] != 'COMPLETED'
                         or p['current_user']['is_seated'] or can_end)), None)
                if preview is not None:
                    preview.update(table_id=after_game.table.table_id, table_revision=claim.revision,
                                   created_at=created_at, can_end_table=can_end)
                    preview = jsonable_encoder(preview)
                message = dict(type='VIEW_DELTA', table_id=str(claim.table_id), match_id=data['match_id'],
                    viewer_seat=after['your_player_id'], delta=delta, table_preview=preview,
                    preview_checksum=view_checksum(preview))
            except (DeltaError, ValueError):
                message = reset
            messages.append((user, message))
        return messages

    async def finish(self, claim, messages):
        async with self.pool.connection() as c:
            async with c.transaction():
                lane = await PostgresInboxStore(self.pool).ensure_lane_in_transaction(c,
                    LaneTarget(kind='table', room_id=claim.after['data']['room_id'], table_id=claim.table_id))
                # Follow command lock order: lane before generation job. Backlog
                # compaction runs under the table/lane write path.
                await c.execute('SELECT lane_id FROM command_lanes WHERE lane_id=%s FOR UPDATE', (lane,))
                row = await (await c.execute('''SELECT 1 FROM view_generation_jobs WHERE table_id=%s AND revision=%s
                    AND status='pending' AND claim_token=%s AND claim_expires_at>clock_timestamp() FOR UPDATE''',
                    (claim.table_id, claim.revision, claim.token))).fetchone()
                if not row:
                    return False
                end = await (await c.execute('''UPDATE command_lanes SET emitted_sequence=emitted_sequence+%s
                    WHERE lane_id=%s RETURNING emitted_sequence''', (len(messages), lane))).fetchone()
                for seq, (user, payload) in enumerate(messages, end[0] - len(messages) + 1):
                    await c.execute('''INSERT INTO notification_outbox(event_id,lane_id,sequence,event_type,audience_user_id,payload)
                        VALUES (%s,%s,%s,%s,%s,%s)''', (uuid4(), lane, seq, payload['type'], user, Jsonb(payload)))
                await c.execute('''UPDATE view_generation_jobs SET status='completed',completed_at=clock_timestamp(),
                    claim_token=NULL,claim_expires_at=NULL WHERE table_id=%s AND revision=%s''', (claim.table_id, claim.revision))
        return True

    async def process(self, claim):
        try:
            async with asyncio.timeout(self.timeout):
                messages = await self.generate(claim)
                await self.finish(claim, messages)
        except Exception:
            self.failures += 1
            async with self.pool.connection() as c:
                await c.execute('''UPDATE view_generation_jobs SET claim_token=NULL,claim_expires_at=NULL,
                    next_attempt_at=clock_timestamp()+interval '1 second' WHERE table_id=%s AND revision=%s
                    AND claim_token=%s AND status='pending' ''', (claim.table_id, claim.revision, claim.token))

    async def prune(self):
        async with self.pool.connection() as c:
            async with c.transaction():
                await c.execute('''DELETE FROM view_generation_jobs WHERE (table_id,revision) IN (
                    SELECT table_id,revision FROM view_generation_jobs WHERE status='completed'
                    ORDER BY completed_at LIMIT 256 FOR UPDATE SKIP LOCKED)''')
                await c.execute('''DELETE FROM delivery_checkpoints WHERE (table_id,revision) IN (
                    SELECT p.table_id,p.revision FROM delivery_checkpoints p
                    WHERE NOT EXISTS(SELECT 1 FROM view_generation_jobs j WHERE j.table_id=p.table_id
                        AND (j.revision=p.revision OR j.base_revision=p.revision))
                    AND NOT EXISTS(SELECT 1 FROM table_recovery_state r WHERE r.table_id=p.table_id AND r.revision=p.revision)
                    ORDER BY p.created_at LIMIT 256 FOR UPDATE SKIP LOCKED)''')

    async def sweep_once(self):
        async with self._lock:
            await asyncio.gather(*(self.process(c) for c in await self.claim()))
            await self.prune()

    async def start(self):
        if self._task is not None or self._closed:
            raise RuntimeError('Generation worker requires a fresh lifecycle.')
        self._task = asyncio.create_task(self._run(), name='view-generation')

    async def _run(self):
        while not self._closed:
            try:
                async with asyncio.timeout(self.timeout * 2):
                    await self.sweep_once()
            except Exception:
                self.failures += 1
            await asyncio.sleep(self.interval)

    async def stop(self):
        self._closed = True
        if self._task:
            self._task.cancel()
            await _join_cleanup(asyncio.create_task(self._stop()))

    async def _stop(self):
        await asyncio.gather(self._task, return_exceptions=True)
