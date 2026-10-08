"""Shared first-dealer policy for legacy and durable Callbreak starts."""
from callbreak import GameConfig, RedealPolicy, create_match
from card_utils import shuffle, standard_52


def create_callbreak_match(game, rng):
    previous = [u for u in game.users if u in game.callbreak_previous_scores]
    # Stable seat order breaks equal last-place scores. If the loser left, use
    # the lowest-scoring returning player; an entirely new roster draws again.
    dealer = min(previous, key=lambda u: (game.callbreak_previous_scores[u], game.users.index(u))) if previous else None
    policy = RedealPolicy(weak_hand_enabled=game.settings['weak_hand_enabled'],
                         no_spades_enabled=game.settings['no_spades_enabled'])
    return create_match(GameConfig(game.capacity, redeal_policy=policy),
                        initial_dealer=game.users.index(dealer) + 1 if dealer else 1,
                        dealer_selection_deck=shuffle(standard_52(), rng=rng) if dealer is None else None)
