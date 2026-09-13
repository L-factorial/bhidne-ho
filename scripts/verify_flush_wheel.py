"""Run: python -I -S scripts/verify_flush_wheel.py path/to/project.whl"""
from pathlib import Path
from random import Random
import sys
from zipfile import ZipFile


def main():
    if not sys.flags.isolated or not sys.flags.no_site:
        raise SystemExit('Run with python -I -S to disable repository/site-package imports.')
    wheel = Path(sys.argv[1]).resolve()
    with ZipFile(wheel) as archive:
        assert 'flush/engine.py' in archive.namelist()
        assert 'card_utils/cards.py' in archive.namelist()
    sys.path.insert(0, str(wheel))
    import flush
    assert str(wheel) in flush.__file__
    engine = flush.FlushGameEngine(['a', 'b'], initial_chips={'a': 100, 'b': 100},
        rules=flush.FlushRulesConfig(5, 10), rng=Random(7))
    engine.start_game()
    engine.deal_cards(engine.get_state().current_player_id)
    engine.skip_cut(engine.get_state().current_player_id)
    for _ in range(6):
        player = engine.get_state().current_player_id
        engine.bet(player, engine.get_allowed_actions(player).required_bet)
    engine.see_cards('b')
    assert len(engine.get_player_view('b').cards) == 3
    assert not engine.get_player_view('a').cards
    engine.show('b')
    engine.reveal_cards('a')
    flush.validate_game_state(engine.get_state())
    assert engine.get_public_view().status is flush.GameStatus.FINISHED
    assert not any(name.split('.')[0] in {'app', 'callbreak', 'marriage', 'fastapi', 'pydantic'}
                   for name in sys.modules)
    print('Wheel-only Flush round passed:', engine.get_state().settlement.winner_ids)


if __name__ == '__main__':
    main()
