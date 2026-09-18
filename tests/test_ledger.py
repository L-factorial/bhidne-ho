import pytest
from types import SimpleNamespace

from app.ledger import GameLedgerAmount, GameLedgerResult, InMemoryLedgerStore, LedgerService
from app.ledger.models import CreateSettlement
from app.ledger.store import _application_object_id, _application_user_id, _database_user_id
from app.test_games.service import TestGameService as GameService


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


def test_postgres_ledger_identity_boundary_round_trips_application_user_ids():
    user_id = "user-12345678-1234-5678-1234-567812345678"
    assert _application_user_id(_database_user_id(user_id)) == user_id
    with pytest.raises(ValueError, match="durable user IDs"):
        _database_user_id("guest-without-a-uuid")
    assert _application_object_id("12345678123456781234567812345678") == \
        "12345678123456781234567812345678"
    assert _application_object_id("12345678-1234-5678-1234-567812345678") == \
        "12345678123456781234567812345678"


@pytest.mark.asyncio
async def test_ledger_projection_failure_does_not_fail_an_already_committed_game_action(monkeypatch):
    service = GameService(Rooms(), connections=None)
    game = SimpleNamespace(game_type="flush", match_id="finished-game", ledger_retry_at=0)
    attempts = 0

    async def unavailable(_game):
        nonlocal attempts
        attempts += 1
        raise ConnectionError("database unavailable")

    monkeypatch.setattr(service, "_record_completed_ledger", unavailable)
    await service._try_record_completed_ledger(game)
    await service._try_record_completed_ledger(game)
    assert attempts == 1
    assert game.ledger_retry_at > 0
