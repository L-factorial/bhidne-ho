"""Shared first-dealer policy for legacy and durable Callbreak starts."""
from callbreak import GameConfig, RedealPolicy, create_match
from card_utils import Rank, shuffle, standard_52
from callbreak.match_rules import rules_from_settings


def create_callbreak_match(game, rng):
    previous = [u for u in game.users if u in game.callbreak_previous_scores]
    # Stable seat order breaks equal last-place scores. If the loser left, use
    # the lowest-scoring returning player; an entirely new roster draws again.
    dealer = min(previous, key=lambda u: (game.callbreak_previous_scores[u], game.users.index(u))) if previous else None
    minimum = game.settings.get('minimum_face_card')
    policy = RedealPolicy(weak_hand_enabled=minimum != 'ANY' if minimum else game.settings['weak_hand_enabled'],
                         weak_hand_threshold=Rank.TEN if minimum == 'JACK' else Rank.JACK,
                         no_spades_enabled=game.settings['no_spades_enabled'])
    rules = rules_from_settings(game.settings, game.capacity) if game.settings.get('match_rules') is not None else None
    return create_match(GameConfig(game.capacity, redeal_policy=policy, match_rules=rules),
                        initial_dealer=game.users.index(dealer) + 1 if dealer else 1,
                        dealer_selection_deck=shuffle(standard_52(), rng=rng) if dealer is None else None)
