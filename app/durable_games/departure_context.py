"""Committed, actor-specific departure hints for the original confirmation UI."""
from .checkpoint_store import PostgresCheckpointStore, user_uuid
from .queries import _ProjectionHost
from .recovery import rebuild_hosted_game


def game_departure(game, actor, *, conflict=False):
    me = game.table.view(game, actor)['current_user']
    action = ('abandon' if me['can_abandon_match'] else 'leave'
              if me['can_leave_seat'] or (game.game_type in ('marriage', 'flush') and me['is_in_active_match'])
              else 'end')
    return dict(code='PLAYER_ALREADY_AT_TABLE' if conflict else 'LEAVE_GAME_REQUIRED',
        room_id=game.room_id, match_id=game.match_id,
        requires_leave_game=action != 'end', departure_command=action)


async def occupied_context(connection, pool, actor, exclude=None):
    row = await (await connection.execute('''SELECT table_id FROM active_table_players
        WHERE user_id=%s AND (%s::uuid IS NULL OR table_id<>%s::uuid)''',
        (user_uuid(actor), exclude, exclude))).fetchone()
    if row is None:
        return None
    saved = await PostgresCheckpointStore(pool).load_in_snapshot(connection, row[0])
    host = _ProjectionHost(None, None)
    game = rebuild_hosted_game(host, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
    return game_departure(game, actor, conflict=True)
