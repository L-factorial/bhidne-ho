"""Completed-match replacement on the same table; never starts an engine."""
from copy import deepcopy
from uuid import NAMESPACE_URL, UUID, uuid5

from psycopg.types.json import Jsonb

from app.runtime.command_runtime import CommandSession
from app.test_games.service import HostedGame
from .checkpoints import canonical_json
from .store import DurableGameConflict


def rematch_id(lane_id, actor, command_id, previous_match_id):
    return uuid5(NAMESPACE_URL, canonical_json(['bhidne-ho:next-match:v1',
        str(UUID(str(lane_id))), actor, command_id, str(UUID(previous_match_id))]))


def rematch_rejection(game, actor):
    if game.game_type == 'flush':
        return 'Flush uses round restart, not next-match.'
    if not game.finished or game.table.phase != 'COMPLETED':
        return 'Complete this match before creating the next one.'
    if not game.table.view(game, actor)['current_user']['can_next_match'] or game.table.pending():
        return 'The current host needs a ready roster with no outstanding releases or offers.'
    return None


async def build_rematch(claim, game, stored):
    connection = claim.connection
    new_id = rematch_id(claim.entry.lane_id, claim.entry.actor_id,
                        claim.entry.request.command_id, game.match_id)
    collision = await (await connection.execute('''SELECT 1 FROM games WHERE id=%s
        UNION ALL SELECT 1 FROM table_recovery_state WHERE match_id=%s
        UNION ALL SELECT 1 FROM hosted_match_archives WHERE match_id=%s LIMIT 1''',
        (new_id, new_id, new_id))).fetchone()
    if collision:
        raise DurableGameConflict('Rematch identity already exists without its completed receipt.')
    intent = await (await connection.execute('''SELECT 1 FROM game_finalization_jobs
        WHERE game_id=%s AND round_number=0 AND job_type='hosted_settlement' ''', (game.durable_game_id,))).fetchone()
    if intent is None:
        raise DurableGameConflict('Completed match is missing its finalization intent.')
    # Archive BEFORE replacing the current document, preserving historical users,
    # rules, engine seats and final state even while settlement work is pending.
    await connection.execute('''INSERT INTO hosted_match_archives
        (game_id,table_id,match_id,table_revision,checkpoint) VALUES (%s,%s,%s,%s,%s)''',
        (game.durable_game_id, UUID(game.table.table_id), UUID(game.match_id),
         stored.checkpoint['data']['table_revision'], Jsonb(stored.checkpoint)))
    table = deepcopy(game.table)
    roster = [u for u in table.seats(game) if u is not None]
    table.phase = 'OPEN'
    table.next_seats = None
    table.releases.clear()
    # Resolved offers and invitations are retained in the archived checkpoint;
    # they must not refer to the old match in the new lobby.
    table.offers.clear()
    new = HostedGame(game.room_id, game.capacity, roster, name=game.name, game_type=game.game_type,
        table=table, previous_match_id=game.match_id, settings=deepcopy(game.settings),
        marriage_scoring=game.marriage_scoring,
        commands=CommandSession(match_id=new_id.hex, receipt_limit=stored.receipt_snapshot['receipt_limit']))
    table.emit('NEXT_MATCH_READY', match_id=new.match_id, previous_match_id=game.match_id)
    return new
