"""Detached Flush round preparation with a new durable round identity."""
from copy import deepcopy
from uuid import NAMESPACE_URL, UUID, uuid5

from psycopg.types.json import Jsonb
from flush import FlushError
from app.adapters.flush import FlushAdapter
from app.games.base import GameCommandRejected
from app.test_games.flush import HostedFlushTarget
from .checkpoints import canonical_json
from .store import DurableGameConflict


def round_id(lane_id, actor, command_id, previous_game_id):
    return uuid5(NAMESPACE_URL, canonical_json(['bhidne-ho:flush-round:v1',
        str(UUID(str(lane_id))), actor, command_id, str(previous_game_id)]))


async def restart_flush(claim, host, game, stored):
    if game.pending_flush_departures:
        raise DurableGameConflict('Completed round still has unreconciled departures.')
    pending = await (await claim.connection.execute('''SELECT count(*) FROM command_inbox
        WHERE dedup_match_id=%s AND status='pending' ''', (UUID(game.match_id),))).fetchone()
    if stored.receipt_snapshot['receipt_count'] + pending[0] >= stored.receipt_snapshot['receipt_limit']:
        raise GameCommandRejected('RECEIPT_LIMIT', 'This hosted match has reached its command receipt limit.')
    engine = deepcopy(game.flush_target.adapter.checkpoint())
    previous = engine.get_state()
    seats = tuple(str(game.flush_seats[u]) for u in game.users)
    owner = str(game.flush_seats[game.users[0]])
    dealer = next((p for p in previous.settlement.winner_ids if p in seats), owner)
    try:
        engine.prepare_next_round(dealer, player_ids=seats)
    except (FlushError, ValueError) as error:
        raise GameCommandRejected('ROUND_START_REJECTED', str(error)) from error
    next_id = round_id(claim.entry.lane_id, claim.entry.actor_id,
                       claim.entry.request.command_id, game.durable_game_id)
    connection = claim.connection
    if await (await connection.execute('SELECT 1 FROM games WHERE id=%s', (next_id,))).fetchone():
        raise DurableGameConflict('Round identity already exists without its completed receipt.')
    intent = await (await connection.execute('''SELECT 1 FROM game_finalization_jobs
        WHERE game_id=%s AND round_number=%s AND job_type='hosted_settlement' ''',
        (game.durable_game_id, previous.round_number))).fetchone()
    if intent is None:
        raise DurableGameConflict('Completed Flush round is missing its finalization intent.')
    await connection.execute('''INSERT INTO hosted_match_archives
        (game_id,table_id,match_id,table_revision,checkpoint) VALUES (%s,%s,%s,%s,%s)''',
        (game.durable_game_id, UUID(game.table.table_id), UUID(game.match_id),
         stored.checkpoint['data']['table_revision'], Jsonb(stored.checkpoint)))
    game.flush_target = HostedFlushTarget(host, game,
        FlushAdapter(engine, match_id=game.match_id, owner_player_id=owner))
    game.durable_game_id = next_id
    game.flush_queries.clear()
    game.play_mode = 'manual'
    game.table.phase = 'STARTED'
    game.table.emit('GAME_STARTED', match_id=game.match_id, round_number=previous.round_number + 1)
    return []
