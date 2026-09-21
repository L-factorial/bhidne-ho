from copy import deepcopy
from datetime import datetime, timezone
from uuid import UUID, uuid4

from .models import GameLedgerResult


def _database_user_id(user_id: str) -> UUID:
    try:
        return UUID(user_id.removeprefix("user-"))
    except (AttributeError, ValueError) as error:
        raise ValueError("Ledger players require durable user IDs.") from error


def _application_user_id(user_id) -> str:
    return f"user-{user_id}"


def _application_object_id(value) -> str:
    return value.hex if isinstance(value, UUID) else UUID(str(value)).hex


def now():
    return datetime.now(timezone.utc).isoformat()


async def _executemany(connection, query, params):
    """Run a bulk statement through psycopg's async cursor API."""
    async with connection.cursor() as cursor:
        await cursor.executemany(query, params)


class InMemoryLedgerStore:
    def __init__(self):
        self.games: dict[str, dict] = {}
        self.batches: dict[str, dict] = {}
        self.request_ids: dict[tuple[str, str], str] = {}
        self.action_ids: set[tuple[str, str, str]] = set()

    async def record_game(self, result: GameLedgerResult):
        value = result.model_dump()
        old = self.games.get(result.game_id)
        if old is not None and old != value:
            raise ValueError("Game result already exists with different values.")
        self.games[result.game_id] = value

    async def room_games(self, room_id):
        return deepcopy([game for game in self.games.values() if game["room_id"] == room_id])

    async def room_batches(self, room_id):
        return deepcopy([batch for batch in self.batches.values() if batch["room_id"] == room_id])

    async def create_batch(self, room_id, user_id, request, games, balances, transfers):
        key = (user_id, request.idempotency_key)
        if key in self.request_ids:
            return deepcopy(self.batches[self.request_ids[key]])
        claimed = {game["game_id"] for batch in self.batches.values()
                   if batch["status"] in ("OPEN", "PARTIALLY_RESOLVED", "RESOLVED")
                   for game in batch["games"]}
        if claimed.intersection(game["game_id"] for game in games):
            raise ValueError("One or more games are already in a settlement.")
        batch_id = uuid4().hex
        batch = {"batch_id": batch_id, "room_id": room_id, "table_id": request.table_id,
                 "scope": request.scope, "game_id": request.game_id, "games": [g["game_id"] for g in games],
                 "balances": balances, "status": "OPEN", "created_by": user_id, "created_at": now(),
                 "idempotency_key": request.idempotency_key,
                 "transfers": [{"transfer_id": uuid4().hex, "payer_id": payer, "payee_id": payee,
                                "amount": amount, "status": "OPEN", "marked_paid_at": None,
                                "resolved_at": None} for payer, payee, amount in transfers]}
        self.batches[batch_id] = batch
        self.request_ids[key] = batch_id
        return deepcopy(batch)

    async def get_batch(self, batch_id):
        return self.batches.get(batch_id)

    async def act(self, batch_id, transfer_id, user_id, action, idempotency_key):
        batch = self.batches.get(batch_id)
        if not batch:
            raise KeyError("Settlement not found.")
        transfer = next((row for row in batch["transfers"] if row["transfer_id"] == transfer_id), None)
        if not transfer:
            raise KeyError("Transfer not found.")
        request_key = (user_id, action, idempotency_key)
        if request_key in self.action_ids:
            return deepcopy(batch)
        if action == "mark-paid":
            if transfer["payer_id"] != user_id:
                raise PermissionError("Only the payer can mark this transfer paid.")
            if transfer["status"] != "OPEN":
                raise ValueError("Only an open transfer can be marked paid.")
            transfer["status"], transfer["marked_paid_at"] = "MARKED_PAID", now()
        elif action == "confirm":
            if transfer["payee_id"] != user_id:
                raise PermissionError("Only the payee can confirm receipt.")
            if transfer["status"] != "MARKED_PAID":
                raise ValueError("The payer must mark this transfer paid first.")
            transfer["status"], transfer["resolved_at"] = "RESOLVED", now()
        else:
            raise ValueError("Unknown settlement action.")
        statuses = {row["status"] for row in batch["transfers"]}
        batch["status"] = "RESOLVED" if statuses == {"RESOLVED"} else (
            "PARTIALLY_RESOLVED" if "RESOLVED" in statuses else "OPEN")
        self.action_ids.add(request_key)
        return deepcopy(batch)


class PostgresLedgerStore:
    def __init__(self, pool):
        self.pool = pool

    async def record_game(self, result):
        async with self.pool.connection() as connection, connection.transaction():
            row = await (await connection.execute(
                "INSERT INTO ledger_games (game_id,room_id,table_id,game_type,table_name) VALUES (%s,%s,%s,%s,%s) "
                "ON CONFLICT (game_id) DO NOTHING RETURNING game_id",
                (result.game_id, result.room_id, result.table_id, result.game_type, result.table_name))).fetchone()
            if row:
                await _executemany(connection,
                    "INSERT INTO game_ledger_entries (game_id,player_id,amount) VALUES (%s,%s,%s)",
                    [(result.game_id, _database_user_id(item.player_id), item.amount)
                     for item in result.amounts])
                return
            existing = await (await connection.execute(
                "SELECT room_id,table_id::text,game_type FROM ledger_games WHERE game_id=%s", (result.game_id,))).fetchone()
            amounts = await (await connection.execute(
                "SELECT player_id::text,amount FROM game_ledger_entries WHERE game_id=%s ORDER BY player_id",
                (result.game_id,))).fetchall()
            expected = (result.room_id, _application_object_id(result.table_id), result.game_type)
            existing = (existing[0], _application_object_id(existing[1]), existing[2])
            if tuple(existing) != expected or [(_application_user_id(r[0]), r[1]) for r in amounts] != sorted(
                    [(x.player_id, x.amount) for x in result.amounts]):
                raise ValueError("Game result already exists with different values.")

    async def room_games(self, room_id):
        async with self.pool.connection() as connection:
            rows = await (await connection.execute(
                "SELECT g.game_id,g.room_id,g.table_id,g.game_type,e.player_id,e.amount,g.table_name "
                "FROM ledger_games g JOIN game_ledger_entries e USING(game_id) WHERE g.room_id=%s "
                "ORDER BY g.created_at,e.player_id", (room_id,))).fetchall()
        games = {}
        for game_id, room, table, kind, player, amount, table_name in rows:
            games.setdefault(_application_object_id(game_id), {"game_id": _application_object_id(game_id),
                "room_id": room, "table_id": _application_object_id(table),
                "game_type": kind, "table_name": table_name, "amounts": []})["amounts"].append({
                    "player_id": _application_user_id(player), "amount": amount})
        return list(games.values())

    async def room_batches(self, room_id):
        async with self.pool.connection() as connection:
            batches = await (await connection.execute(
                "SELECT batch_id,table_id,scope,game_id,status,created_by,created_at,idempotency_key FROM settlement_batches "
                "WHERE room_id=%s ORDER BY created_at DESC", (room_id,))).fetchall()
            result = []
            for row in batches:
                transfers = await (await connection.execute(
                    "SELECT transfer_id,payer_id,payee_id,amount,status,marked_paid_at,resolved_at "
                    "FROM settlement_transfers WHERE batch_id=%s ORDER BY transfer_id", (row[0],))).fetchall()
                games = await (await connection.execute(
                    "SELECT game_id FROM settlement_games WHERE batch_id=%s", (row[0],))).fetchall()
                result.append({"batch_id": str(row[0]), "room_id": room_id,
                    "table_id": _application_object_id(row[1]), "scope": row[2],
                    "game_id": _application_object_id(row[3]) if row[3] else None, "status": row[4],
                    "created_by": _application_user_id(row[5]), "created_at": row[6].isoformat(), "idempotency_key": row[7],
                    "games": [_application_object_id(x[0]) for x in games],
                    "transfers": [{"transfer_id": str(t[0]), "payer_id": _application_user_id(t[1]),
                        "payee_id": _application_user_id(t[2]),
                        "amount": t[3], "status": t[4], "marked_paid_at": t[5].isoformat() if t[5] else None,
                        "resolved_at": t[6].isoformat() if t[6] else None} for t in transfers]})
            return result

    async def get_batch(self, batch_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute(
                "SELECT room_id FROM settlement_batches WHERE batch_id=%s", (batch_id,))).fetchone()
        if not row:
            return None
        return next((batch for batch in await self.room_batches(row[0]) if batch["batch_id"] == batch_id), None)

    async def create_batch(self, room_id, user_id, request, games, balances, transfers):
        async with self.pool.connection() as connection, connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (room_id + ':' + request.table_id,))
            old = await (await connection.execute(
                "SELECT batch_id FROM settlement_batches WHERE created_by=%s AND idempotency_key=%s",
                (_database_user_id(user_id), request.idempotency_key))).fetchone()
            if old:
                return next(x for x in await self.room_batches(room_id) if x["batch_id"] == str(old[0]))
            ids = [game["game_id"] for game in games]
            claimed = await (await connection.execute(
                "SELECT game_id FROM settlement_games WHERE game_id = ANY(%s::uuid[])", (ids,))).fetchone()
            if claimed:
                raise ValueError("One or more games are already in a settlement.")
            batch_id = uuid4()
            await connection.execute(
                "INSERT INTO settlement_batches(batch_id,room_id,table_id,scope,game_id,status,created_by,idempotency_key) "
                "VALUES(%s,%s,%s,%s,%s,'OPEN',%s,%s)",
                (batch_id, room_id, request.table_id, request.scope, request.game_id,
                 _database_user_id(user_id), request.idempotency_key))
            await _executemany(connection,
                "INSERT INTO settlement_games(batch_id,game_id) VALUES(%s,%s)",
                [(batch_id, game["game_id"]) for game in games])
            await _executemany(connection,
                "INSERT INTO settlement_transfers(transfer_id,batch_id,payer_id,payee_id,amount,status) "
                "VALUES(%s,%s,%s,%s,%s,'OPEN')",
                [(uuid4(), batch_id, _database_user_id(payer), _database_user_id(payee), amount)
                 for payer, payee, amount in transfers])
        return next(x for x in await self.room_batches(room_id) if x["batch_id"] == str(batch_id))

    async def act(self, batch_id, transfer_id, user_id, action, idempotency_key):
        async with self.pool.connection() as connection, connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (batch_id,))
            prior = await (await connection.execute(
                "SELECT 1 FROM settlement_actions WHERE actor_id=%s AND action=%s AND idempotency_key=%s",
                (_database_user_id(user_id), action, idempotency_key))).fetchone()
            row = await (await connection.execute(
                "SELECT b.room_id,t.payer_id,t.payee_id,t.status FROM settlement_transfers t "
                "JOIN settlement_batches b USING(batch_id) WHERE t.batch_id=%s AND t.transfer_id=%s",
                (batch_id, transfer_id))).fetchone()
            if not row: raise KeyError("Transfer not found.")
            if not prior:
                room_id, payer_value, payee_value, status = row
                payer, payee = _application_user_id(payer_value), _application_user_id(payee_value)
                if action == "mark-paid":
                    if payer != user_id: raise PermissionError("Only the payer can mark this transfer paid.")
                    if status != "OPEN": raise ValueError("Only an open transfer can be marked paid.")
                    await connection.execute("UPDATE settlement_transfers SET status='MARKED_PAID',marked_paid_at=now() WHERE transfer_id=%s", (transfer_id,))
                elif action == "confirm":
                    if payee != user_id: raise PermissionError("Only the payee can confirm receipt.")
                    if status != "MARKED_PAID": raise ValueError("The payer must mark this transfer paid first.")
                    await connection.execute("UPDATE settlement_transfers SET status='RESOLVED',resolved_at=now() WHERE transfer_id=%s", (transfer_id,))
                else: raise ValueError("Unknown settlement action.")
                await connection.execute("INSERT INTO settlement_actions(actor_id,action,idempotency_key,transfer_id) VALUES(%s,%s,%s,%s)",
                                         (_database_user_id(user_id), action, idempotency_key, transfer_id))
                await connection.execute("UPDATE settlement_batches b SET status=CASE "
                    "WHEN NOT EXISTS(SELECT 1 FROM settlement_transfers t WHERE t.batch_id=b.batch_id AND t.status<>'RESOLVED') THEN 'RESOLVED' "
                    "WHEN EXISTS(SELECT 1 FROM settlement_transfers t WHERE t.batch_id=b.batch_id AND t.status='RESOLVED') THEN 'PARTIALLY_RESOLVED' ELSE 'OPEN' END WHERE batch_id=%s", (batch_id,))
        return next(x for x in await self.room_batches(row[0]) if x["batch_id"] == batch_id)
