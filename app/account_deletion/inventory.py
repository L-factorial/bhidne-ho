"""Read-only deletion preflight. Counts are not proof that all personal data is gone.

Internal only: callers must authenticate before exposing account-specific results.
The execution transaction must recheck these dependencies under its write locks.
No deletion is authorized by a preflight result and no provider/email data is returned.
"""
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class DeletionInventory:
    account_kind: str
    password_account: bool
    providers: tuple[str, ...]
    active_games: int
    reserved_tables: int
    table_positions: int
    owned_rooms: int
    pending_commands: int
    ledger_entries: int
    unsettled_transfers: int
    authored_messages: int

    @property
    def dependencies(self) -> tuple[str, ...]:
        result = []
        if self.active_games or self.reserved_tables or self.table_positions:
            result.append('active_participation')
        if self.owned_rooms:
            result.append('room_ownership')
        if self.pending_commands:
            result.append('queued_commands')
        if self.ledger_entries or self.unsettled_transfers:
            result.append('shared_ledger')
        if self.providers:
            result.append('provider_revocation')
        return tuple(result)


async def inspect_account(connection, user_id: str) -> DeletionInventory | None:
    """Use an existing transaction; read no secret, chat text or provider subject."""
    if not isinstance(user_id, str) or not user_id.startswith('user-'):
        raise ValueError('Expected an application user identity.')
    identity = UUID(user_id[5:])
    row = await (await connection.execute('SELECT kind FROM users WHERE id=%s', (identity,))).fetchone()
    if row is None:
        return None
    password = await (await connection.execute(
        'SELECT EXISTS(SELECT 1 FROM account_credentials WHERE user_id=%s)', (identity,))).fetchone()
    providers = await (await connection.execute(
        'SELECT provider FROM external_identities WHERE user_id=%s ORDER BY provider', (identity,))).fetchall()
    queries = {
        'active_games': ('SELECT count(*) FROM active_game_players WHERE user_id=%s', (identity,)),
        'reserved_tables': ('SELECT count(*) FROM active_table_players WHERE user_id=%s', (identity,)),
        'table_positions': ('SELECT count(*) FROM table_positions WHERE user_id=%s', (identity,)),
        'owned_rooms': ('SELECT count(*) FROM rooms WHERE creator_id=%s', (identity,)),
        'pending_commands': ("SELECT count(*) FROM command_inbox WHERE actor_id=%s AND status='pending'", (user_id,)),
        'ledger_entries': ('SELECT count(*) FROM game_ledger_entries WHERE player_id=%s', (identity,)),
        'unsettled_transfers': ("SELECT count(*) FROM settlement_transfers WHERE (payer_id=%s OR payee_id=%s) AND status NOT IN ('RESOLVED','CANCELLED')", (identity, identity)),
        'authored_messages': ('''SELECT (SELECT count(*) FROM direct_messages WHERE sender_id=%s)
            + (SELECT count(*) FROM room_chat_messages WHERE sender_id=%s)''', (identity, identity)),
    }
    counts = {}
    for name, (query, parameters) in queries.items():
        counts[name] = (await (await connection.execute(query, parameters)).fetchone())[0]
    return DeletionInventory(row[0], password[0], tuple(p[0] for p in providers), **counts)
