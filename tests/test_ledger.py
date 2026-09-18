import pytest

from app.ledger import GameLedgerAmount, GameLedgerResult, InMemoryLedgerStore, LedgerService
from app.ledger.models import CreateSettlement


class Rooms:
    async def members(self, room_id):
        return ["alice", "bob", "carol"]


def result(game, table, amounts):
    return GameLedgerResult(room_id="room", table_id=table, game_id=game, game_type="marriage",
        amounts=[GameLedgerAmount(player_id=player, amount=amount) for player, amount in amounts.items()])


@pytest.mark.asyncio
async def test_room_and_table_ledgers_are_sorted_and_game_recording_is_idempotent():
    service = LedgerService(InMemoryLedgerStore(), Rooms())
    first = result("game-1", "table-1", {"alice": 50, "bob": 20, "carol": -70})
    second = result("game-2", "table-1", {"alice": -20, "bob": 0, "carol": 20})
    await service.record_game(first)
    await service.record_game(first)
    await service.record_game(second)
    view = await service.snapshot("room", "alice")
    assert view["balances"] == [{"player_id": "alice", "amount": 30},
                                {"player_id": "bob", "amount": 20},
                                {"player_id": "carol", "amount": -50}]
    assert view["tables"][0]["game_count"] == 2
    assert view["tables"][0]["suggested_transfers"] == [
        {"payer_id": "carol", "payee_id": "alice", "amount": 30},
        {"payer_id": "carol", "payee_id": "bob", "amount": 20}]


@pytest.mark.asyncio
async def test_table_settlement_is_frozen_idempotent_and_two_party_confirmed():
    service = LedgerService(InMemoryLedgerStore(), Rooms())
    await service.record_game(result("game-1", "table-1", {"alice": 30, "bob": -10, "carol": -20}))
    request = CreateSettlement(scope="table", table_id="table-1", idempotency_key="start-1")
    batch = await service.create_settlement("room", "bob", request)
    assert batch == await service.create_settlement("room", "bob", request)
    bob = next(row for row in batch["transfers"] if row["payer_id"] == "bob")
    with pytest.raises(PermissionError):
        await service.act("room", batch["batch_id"], bob["transfer_id"], "alice", "mark-paid", "wrong")
    marked = await service.act("room", batch["batch_id"], bob["transfer_id"], "bob", "mark-paid", "paid")
    assert next(x for x in marked["transfers"] if x["transfer_id"] == bob["transfer_id"])["status"] == "MARKED_PAID"
    confirmed = await service.act("room", batch["batch_id"], bob["transfer_id"], "alice", "confirm", "received")
    assert confirmed["status"] == "PARTIALLY_RESOLVED"
    view = await service.snapshot("room", "alice")
    assert len(view["personal_settlements"]) == 2
    assert view["tables"][0]["suggested_transfers"] == []
    assert {row["status"] for row in view["tables"][0]["transactions"]} == {"OPEN", "RESOLVED"}


@pytest.mark.asyncio
async def test_only_an_involved_player_can_start_a_settlement():
    service = LedgerService(InMemoryLedgerStore(), Rooms())
    await service.record_game(result("game-1", "table-1", {"alice": 10, "bob": -10, "carol": 0}))
    with pytest.raises(PermissionError, match="outstanding balance"):
        await service.create_settlement("room", "carol",
            CreateSettlement(scope="game", table_id="table-1", game_id="game-1", idempotency_key="no"))


def test_game_results_must_be_zero_sum_and_unique_per_player():
    with pytest.raises(ValueError, match="zero-sum"):
        result("bad", "table", {"alice": 3, "bob": -2})
    with pytest.raises(ValueError, match="only once"):
        GameLedgerResult(room_id="room", table_id="table", game_id="bad", game_type="flush",
            amounts=[GameLedgerAmount(player_id="alice", amount=1),
                     GameLedgerAmount(player_id="alice", amount=-1)])
