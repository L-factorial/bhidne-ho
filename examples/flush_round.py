"""Run with: python -m examples.flush_round (no server or UI required)."""
from random import Random
from flush import FlushGameEngine, FlushRulesConfig


def main():
    engine = FlushGameEngine(
        ['alice', 'bob'], initial_chips={'alice': 100, 'bob': 100},
        rules=FlushRulesConfig(boot_amount=5, initial_blind_bet=10), rng=Random(7),
    )
    engine.start_game()
    engine.deal_cards(engine.get_state().current_player_id)
    engine.skip_cut(engine.get_state().current_player_id)
    # Both players explicitly make three blind bets; boot does not count.
    for _ in range(6):
        player = engine.get_state().current_player_id
        engine.bet(player, engine.get_allowed_actions(player).required_bet)
    engine.see_cards('bob')
    assert engine.get_state().current_player_id == 'bob'
    assert len(engine.get_player_view('bob').cards) == 3
    assert engine.get_player_view('alice').cards == ()
    engine.show('bob')
    engine.reveal_cards('alice')
    result = engine.get_public_view()
    print('Winners:', ', '.join(result.settlement.winner_ids))
    print('Pot:', result.pot, 'Payouts:', result.settlement.payouts)


if __name__ == '__main__':
    main()
