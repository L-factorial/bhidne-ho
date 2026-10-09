"""Versioned private replay records, not public events or client snapshots.

Restoring a record revalidates every command through the reducer. Decks are
explicit so results do not depend on a random implementation or seed version.
"""

import json
from dataclasses import dataclass, asdict

from card_utils import Card, Rank

from .commands import AcceptHand, ClaimRedeal, PlaceBid, PlayCard, Redeal, StartDeal
from .commands import PrepareDeal, ShuffleDeck, CompleteShuffle, CutDeck, SkipCut, StartDistribution, PickDealerCard
from .config import GameConfig
from .engine import apply_control, apply_player, create_match
from .events import Transition
from .game import MatchState
from .house_rules import RedealPolicy
from .match_rules import MatchRules


@dataclass(frozen=True)
class Entry:
    actor: int | None
    command: StartDeal | Redeal | PlaceBid | PlayCard | AcceptHand | ClaimRedeal | PrepareDeal | ShuffleDeck | CompleteShuffle | CutDeck | SkipCut | StartDistribution | PickDealerCard


@dataclass(frozen=True)
class Replay:
    config: GameConfig
    initial_dealer: int
    entries: tuple[Entry, ...] = ()
    dealer_selection_deck: tuple[Card, ...] | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "entries", tuple(self.entries))
        if self.dealer_selection_deck is not None:
            object.__setattr__(self, "dealer_selection_deck", tuple(self.dealer_selection_deck))

    def restore(self) -> MatchState:
        state = create_match(self.config, initial_dealer=self.initial_dealer, dealer_selection_deck=self.dealer_selection_deck)
        for i, entry in enumerate(self.entries):
            result = apply_control(state, entry.command) if entry.actor is None else apply_player(state, entry.actor, entry.command)
            if not isinstance(result, Transition):
                raise ValueError(f"Invalid replay entry {i}: {result.code}")
            state = result.state
        return state

    def dumps(self) -> str:
        policy = self.config.redeal_policy
        rows = []
        for entry in self.entries:
            command = entry.command
            row = {"actor": entry.actor, "command": type(command).__name__}
            if type(command) in (StartDeal, Redeal, CompleteShuffle):
                row["deck"] = [str(card) for card in command.deck]
            elif type(command) is PlaceBid:
                row["amount"] = command.amount
            elif type(command) is PlayCard:
                row["card"] = str(command.card)
            elif type(command) in (CutDeck, PickDealerCard):
                row["position"] = command.position
            elif type(command) not in (AcceptHand, ClaimRedeal, PrepareDeal, ShuffleDeck, SkipCut, StartDistribution):
                raise ValueError("Unsupported replay command.")
            rows.append(row)
        record = {"version": 1, "config": {
            "player_count": self.config.player_count, "deals_per_match": 5,
            "ruleset": self.config.ruleset, "undealt_policy": self.config.undealt_policy,
            "weak_hand_enabled": policy.weak_hand_enabled,
            "weak_hand_threshold": policy.weak_hand_threshold.name,
            "no_spades_enabled": policy.no_spades_enabled,
        }, "initial_dealer": self.initial_dealer, "entries": rows}
        if self.config.match_rules is not None:
            record['config']['match_rules'] = asdict(self.config.match_rules)
        if self.dealer_selection_deck is not None:
            record['dealer_selection_deck'] = list(map(str, self.dealer_selection_deck))
        return json.dumps(record, sort_keys=True)

    @classmethod
    def loads(cls, text: str) -> "Replay":
        def exact(value, keys):
            if not isinstance(value, dict) or set(value) != set(keys.split()):
                raise ValueError("Invalid replay fields.")
        try:
            data = json.loads(text)
            exact(data, "version config initial_dealer entries" + (" dealer_selection_deck" if 'dealer_selection_deck' in data else ""))
            if type(data["version"]) is not int or data["version"] != 1:
                raise ValueError("Unsupported replay version.")
            c = data["config"]
            exact(c, "player_count deals_per_match ruleset undealt_policy weak_hand_enabled weak_hand_threshold no_spades_enabled" + (' match_rules' if 'match_rules' in c else ''))
            config = GameConfig(c["player_count"], c["deals_per_match"],
                                RedealPolicy(c["weak_hand_enabled"], Rank[c["weak_hand_threshold"]], c["no_spades_enabled"]),
                                c["undealt_policy"], c["ruleset"],
                                MatchRules(**c['match_rules']) if 'match_rules' in c else None)
            if not isinstance(data["entries"], list):
                raise ValueError("Entries must be a list.")
            entries = []
            for row in data["entries"]:
                if not isinstance(row, dict):
                    raise ValueError("Invalid entry.")
                name = row.get("command")
                if name in ("StartDeal", "Redeal", "CompleteShuffle"):
                    exact(row, "actor command deck")
                    if not isinstance(row["deck"], list):
                        raise ValueError("Deck must be a list.")
                    command = {"StartDeal": StartDeal, "Redeal": Redeal, "CompleteShuffle": CompleteShuffle}[name](tuple(Card.parse(c) for c in row["deck"]))
                elif name == "PlaceBid":
                    exact(row, "actor command amount")
                    command = PlaceBid(row["amount"])
                elif name == "PlayCard":
                    exact(row, "actor command card")
                    command = PlayCard(Card.parse(row["card"]))
                elif name in ("CutDeck", "PickDealerCard"):
                    exact(row, "actor command position")
                    command = (CutDeck if name == "CutDeck" else PickDealerCard)(row["position"])
                elif name in ("AcceptHand", "ClaimRedeal", "PrepareDeal", "ShuffleDeck", "SkipCut", "StartDistribution"):
                    exact(row, "actor command")
                    command = {"AcceptHand": AcceptHand, "ClaimRedeal": ClaimRedeal,
                               "PrepareDeal": PrepareDeal, "ShuffleDeck": ShuffleDeck, "SkipCut": SkipCut, "StartDistribution": StartDistribution}[name]()
                else:
                    raise ValueError("Unknown replay command.")
                entries.append(Entry(row["actor"], command))
            replay = cls(config, data["initial_dealer"], tuple(entries),
                         tuple(Card.parse(c) for c in data['dealer_selection_deck']) if 'dealer_selection_deck' in data else None)
            replay.restore()
            return replay
        except (KeyError, TypeError, AttributeError) as error:
            raise ValueError("Malformed replay.") from error
