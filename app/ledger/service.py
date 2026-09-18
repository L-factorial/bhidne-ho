from collections import defaultdict


def sorted_balances(values):
    return [{"player_id": player, "amount": amount} for player, amount in
            sorted(values.items(), key=lambda row: (-row[1], row[0])) if amount]


def transfer_plan(balances):
    creditors = [[player, amount] for player, amount in sorted(balances.items()) if amount > 0]
    debtors = [[player, -amount] for player, amount in sorted(balances.items()) if amount < 0]
    transfers = []
    payer = payee = 0
    while payer < len(debtors) and payee < len(creditors):
        amount = min(debtors[payer][1], creditors[payee][1])
        transfers.append((debtors[payer][0], creditors[payee][0], amount))
        debtors[payer][1] -= amount
        creditors[payee][1] -= amount
        if not debtors[payer][1]: payer += 1
        if not creditors[payee][1]: payee += 1
    return transfers


class LedgerService:
    def __init__(self, store, rooms, profiles=None):
        self.store, self.rooms, self.profiles = store, rooms, profiles

    async def authorize(self, room_id, user_id):
        if user_id not in await self.rooms.members(room_id):
            raise PermissionError("Join this room to view its ledger.")

    async def record_game(self, result):
        await self.store.record_game(result)

    async def snapshot(self, room_id, user_id):
        await self.authorize(room_id, user_id)
        games, batches = await self.store.room_games(room_id), await self.store.room_batches(room_id)
        claimed = {game_id for batch in batches for game_id in batch["games"]}
        room = defaultdict(int)
        tables = {}
        for game in games:
            table = tables.setdefault(game["table_id"], {"table_id": game["table_id"], "game_count": 0,
                "balances": defaultdict(int), "games": [], "suggested_transfers": []})
            table["game_count"] += 1
            game_balances = {row["player_id"]: row["amount"] for row in game["amounts"]}
            table["games"].append({"game_id": game["game_id"], "game_type": game["game_type"],
                                   "balances": sorted_balances(game_balances), "settled": game["game_id"] in claimed})
            for player, amount in game_balances.items():
                room[player] += amount
                table["balances"][player] += amount
        for table in tables.values():
            outstanding = defaultdict(int)
            for game in table["games"]:
                if not game["settled"]:
                    for row in game["balances"]: outstanding[row["player_id"]] += row["amount"]
            table["balances"] = sorted_balances(table["balances"])
            table["suggested_transfers"] = [{"payer_id": a, "payee_id": b, "amount": n}
                                                for a, b, n in transfer_plan(outstanding)]
            table["transactions"] = [dict(transfer, batch_id=batch["batch_id"], scope=batch["scope"])
                                     for batch in batches if batch["table_id"] == table["table_id"]
                                     for transfer in batch["transfers"]]
        names = {}
        for seat, player in enumerate(room, 1):
            value = self.profiles.name(player, seat) if self.profiles else player
            names[player] = value
        personal = [dict(transfer, batch_id=batch["batch_id"], table_id=batch["table_id"], scope=batch["scope"])
                    for batch in batches for transfer in batch["transfers"]
                    if user_id in (transfer["payer_id"], transfer["payee_id"])]
        return {"room_id": room_id, "players": names, "balances": sorted_balances(room),
                "tables": sorted(tables.values(), key=lambda row: row["table_id"]),
                "settlements": batches, "personal_settlements": personal}

    async def create_settlement(self, room_id, user_id, request):
        await self.authorize(room_id, user_id)
        batches = await self.store.room_batches(room_id)
        existing = next((batch for batch in batches if batch["created_by"] == user_id
                         and batch.get("idempotency_key") == request.idempotency_key), None)
        if existing:
            return existing
        games = [game for game in await self.store.room_games(room_id) if game["table_id"] == request.table_id
                 and (request.scope == "table" or game["game_id"] == request.game_id)]
        claimed = {game_id for batch in batches
                   if batch["status"] in ("OPEN", "PARTIALLY_RESOLVED", "RESOLVED") for game_id in batch["games"]}
        games = [game for game in games if game["game_id"] not in claimed]
        if not games:
            raise ValueError("There are no unsettled completed games in this scope.")
        balances = defaultdict(int)
        for game in games:
            for row in game["amounts"]: balances[row["player_id"]] += row["amount"]
        if not balances.get(user_id):
            raise PermissionError("Only a player with an outstanding balance may start this settlement.")
        transfers = transfer_plan(balances)
        if not transfers:
            raise ValueError("This scope has no outstanding balance.")
        return await self.store.create_batch(room_id, user_id, request, games,
                                             sorted_balances(balances), transfers)

    async def act(self, room_id, batch_id, transfer_id, user_id, action, idempotency_key):
        await self.authorize(room_id, user_id)
        existing = await self.store.get_batch(batch_id)
        if not existing or existing["room_id"] != room_id:
            raise KeyError("Settlement not found.")
        batch = await self.store.act(batch_id, transfer_id, user_id, action, idempotency_key)
        return batch
