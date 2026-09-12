"""Run a deterministic Dublee round using only the public engine API.

This example's simple card choices are not engine rules or a production bot.
Run from the repository root: python -m examples.marriage_round
"""
from collections import defaultdict
from random import Random

from marriage import ActionKind, DrawSource, GameStatus, MarriageGameEngine, Meld, MeldType


def pairs_in(hand):
    faces = defaultdict(list)
    for card in sorted(hand, key=lambda c: c.card_id):
        if card.identity is not None:
            faces[card.identity].append(card.card_id)
    return tuple(Meld(MeldType.DUBLEE, tuple(ids[:2])) for ids in faces.values() if len(ids) >= 2)


def run_demo(seed=42, max_turns=2000):
    game = MarriageGameEngine(("p1", "p2"), rng=Random(seed))
    game.start_game()
    for _ in range(max_turns):
        actor = game.get_public_view().current_player_id
        view = game.get_player_view(actor)
        top = game.read_last_card()
        source = DrawSource.STOCK
        committed = {i for p in view.public.players if p.player_id == actor
                     for meld in p.shown_melds for i in meld.card_ids}
        if (DrawSource.DISCARD in view.actions.drawable_sources and top.identity is not None
                and sum(c.identity == top.identity and c.card_id not in committed for c in view.hand) == 1):
            source = DrawSource.DISCARD
        game.draw_card(actor, source)
        view = game.get_player_view(actor)
        pairs = pairs_in(view.hand)
        if ActionKind.SHOW_DUBLEES in view.actions.kinds and len(pairs) >= 7:
            game.show_dublees(actor, pairs[:7])
        if ActionKind.FINISH in game.get_allowed_actions(actor).kinds:
            game.finish(actor)
            assert game.get_public_view().status is GameStatus.FINISHED
            return game
        protected = {i for pair in pairs for i in pair.card_ids}
        choices = game.get_allowed_actions(actor).discardable_card_ids
        # Keep pairs and discard a spare card; deterministic receipt order breaks ties.
        throw = next((i for i in choices if i not in protected), choices[0])
        game.discard_card(actor, throw)
    raise RuntimeError("Example turn limit reached; this is not an engine stalemate rule.")


if __name__ == "__main__":
    engine = run_demo()
    print(f"Winner: {engine.get_public_view().winner}; revision: {engine.get_public_view().revision}")
