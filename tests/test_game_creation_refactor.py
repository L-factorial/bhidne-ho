import random

import pytest
from card_utils import Rank, Card
from callbreak.house_rules import RedealPolicy, redeal_reasons
from app.multiplayer.table_creation import available_table_name
from app.multiplayer.callbreak_dealer import create_callbreak_match
from app.test_games.service import HostedGame
from app.test_games.http import GameSettings


def test_available_numbers_reuse_gaps_and_respect_room_limit():
    assert available_table_name(['Table-1', 'table-3'], 3) == 'Table-2'
    with pytest.raises(ValueError, match='no available game slots'):
        available_table_name(['Table-1', 'Table-2'], 2)


def test_five_player_defaults_skip_review_without_overriding_saved_settings():
    game = HostedGame('room', 5, ['a'], game_type='callbreak')
    assert not game.settings['weak_hand_enabled'] and not game.settings['no_spades_enabled']
    assert not create_callbreak_match(game, random.Random(1)).config.redeal_policy.enabled
    saved = {'weak_hand_enabled': True, 'no_spades_enabled': True, 'payments': [0,0,0,0]}
    restored = HostedGame('room', 5, ['a'], settings=saved, game_type='callbreak')
    assert restored.settings == saved
    assert create_callbreak_match(restored, random.Random(1)).config.redeal_policy.enabled


@pytest.mark.parametrize('minimum,threshold', [('JACK',Rank.TEN),('QUEEN',Rank.JACK)])
def test_face_requirement_maps_to_inclusive_minimum(minimum,threshold):
    game = HostedGame('room', 4, ['a'], settings={'weak_hand_enabled':True,'minimum_face_card':minimum,'no_spades_enabled':False,'payments':[0,0,0,0]})
    assert create_callbreak_match(game, random.Random(1)).config.redeal_policy.weak_hand_threshold == threshold


def test_at_least_jack_accepts_jack_but_rejects_lower_ranks():
    policy = RedealPolicy(True, Rank.TEN, False)
    assert redeal_reasons(tuple(map(Card.parse, 'JS 2H'.split())), policy) == ()
    assert redeal_reasons(tuple(map(Card.parse, '10S 2H'.split())), policy) == ('WEAK_HAND',)


def test_any_normalizes_review_switch_and_minimum_rank_survives_replay():
    settings = GameSettings(match_id='match', minimum_face_card='ANY', no_spades_enabled=False)
    assert not settings.weak_hand_enabled
    from callbreak import GameConfig
    from callbreak.replay import Replay
    config = GameConfig(redeal_policy=RedealPolicy(True, Rank.TEN, False))
    assert Replay.loads(Replay(config, 1, ()).dumps()).config == config
