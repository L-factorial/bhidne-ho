"""Frozen V1 rules. Proposed defaults are recorded in the implementation plan."""
from dataclasses import dataclass
from typing import ClassVar

from .enums import AceSequencePolicy, MaalNeighborPolicy


@dataclass(frozen=True)
class MarriageRules:
    ruleset_id: ClassVar[str] = "marriage-v1"
    min_players: ClassVar[int] = 2
    max_players: ClassVar[int] = 5
    pack_count: ClassVar[int] = 3
    printed_jokers: ClassVar[int] = 3
    cards_per_player: ClassVar[int] = 21
    ace_sequence: AceSequencePolicy = AceSequencePolicy.LOW_ONLY
    maal_neighbors: MaalNeighborPolicy = MaalNeighborPolicy.CYCLIC
    dublee_player_can_draw_discard: bool = False
    dublee_player_can_take_winning_discard: bool = True

    def __post_init__(self):
        if not isinstance(self.ace_sequence, AceSequencePolicy):
            raise ValueError("Unsupported Ace sequence policy.")
        if not isinstance(self.maal_neighbors, MaalNeighborPolicy):
            raise ValueError("Unsupported Maal neighbor policy.")
        if (type(self.dublee_player_can_draw_discard) is not bool
                or type(self.dublee_player_can_take_winning_discard) is not bool):
            raise ValueError("Discard policies must be booleans.")
