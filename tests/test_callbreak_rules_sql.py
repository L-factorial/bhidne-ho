"""Optional PostgreSQL/WASM coverage for terminal custom-rule recovery/settlement."""
from dataclasses import asdict
from types import SimpleNamespace

from app.durable_games.checkpoints import capture_checkpoint, decode_checkpoint
from app.durable_games.executor import GameLaneExecutor
from app.durable_games.finalization import MatchFinalizationWorker
from app.durable_games.inbox import PostgresInboxStore
from callbreak.match_rules import MatchRules
from callbreak.settlement import settlement_amounts
from test_checkpoint_store import database, host_game
from test_callbreak_match_rules import play_deal


async def test_early_win_survives_storage_and_settles_only_once(database):
    pool, store, fence, users = database
    host, game = await host_game(users, 'callbreak')
    try:
        rules = MatchRules(instant_win_enabled=True, instant_win_bid=1)
        game.settings.update(match_rules=asdict(rules), payments=[6, 12, 18, 0])
        game.state = play_deal(4, rules)
        game.table.sync(game)
        checkpoint = capture_checkpoint(game, table_revision=0)
        await store.save(checkpoint, expected_revision=None, fence=fence)
        recovered = decode_checkpoint((await store.load(game.table.table_id)).checkpoint).engine_state
        assert recovered == game.state and recovered.win_reason == 'instant_bid'
        await GameLaneExecutor(PostgresInboxStore(pool))._finalization(SimpleNamespace(connection=pool,
            target=SimpleNamespace(game_id=game.durable_game_id)), checkpoint)
        worker = MatchFinalizationWorker(pool)
        job = (await worker.pending(fence))[0]
        assert await worker.execute(job, fence) == 'projected'
        assert await worker.execute(job, fence) == 'already_completed'
        result = (await worker.ledger.room_games('room'))[0]
        expected = dict(zip(game.users, settlement_amounts(game.state, game.settings['payments'])))
        assert {row['player_id']: row['amount'] for row in result['amounts']} == expected
    finally:
        await host.close()
