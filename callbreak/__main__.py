"""Run a complete local simulation: python -m callbreak --players 5 --seed 7."""

import argparse
from random import Random

from card_utils import shuffle, standard_52

from .audit import audit_match
from .commands import AcceptHand, PlaceBid, PlayCard, StartDeal
from .config import GameConfig
from .engine import apply_control, apply_player, available_cards, create_match
from .events import Transition
from .game import Phase
from .replay import Entry, Replay


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate five Call Break deals without a server.")
    parser.add_argument("--players", type=int, choices=(4, 5), default=4)
    parser.add_argument("--seed", type=int, default=7, help="Deterministic simulation seed, not live shuffling")
    args = parser.parse_args()
    config = GameConfig(args.players)
    state = create_match(config)
    rng = Random(args.seed)
    entries = []
    print(f"{args.players} players · 5 deals · {config.tricks_per_deal} tricks/deal")
    print("Simulation players accept their hands, bid 1, and choose random legal cards.")
    while state.phase != Phase.MATCH_COMPLETE:
        if state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE):
            actor, command = None, StartDeal(shuffle(standard_52(), rng=rng))
            result = apply_control(state, command)
        else:
            if state.phase == Phase.HAND_REVIEW:
                actor = next(p for p in config.players if p not in state.current_deal.accepted_hands)
                command = AcceptHand()
            elif state.phase == Phase.BIDDING:
                actor, command = state.current_player, PlaceBid(1)
            else:
                actor = state.current_player
                command = PlayCard(rng.choice(available_cards(state, actor)))
            result = apply_player(state, actor, command)
        if not isinstance(result, Transition):
            raise RuntimeError(result)
        entries.append(Entry(actor, command))
        state = result.state
        if any(e.name == "DealCompleted" for e in result.events):
            completed = state.completed_deals[-1]
            print(f"Deal {completed.deal.number}: tricks={completed.result.tricks_won} "
                  f"scores={tuple(f'{v / 10:.1f}' for v in completed.result.score_tenths)}")
    audit_match(state)
    assert Replay(config, 1, tuple(entries)).restore() == state
    print(f"Totals: {tuple(f'{v / 10:.1f}' for v in state.score_tenths)}; winners: {state.winners}")
    print("History audit and deterministic replay passed.")


if __name__ == "__main__":
    main()
