from dataclasses import dataclass, field

from .house_rules import RedealPolicy


@dataclass(frozen=True)
class GameConfig:
    player_count: int = 4
    deals_per_match: int = 5
    redeal_policy: RedealPolicy = field(default_factory=RedealPolicy)
    undealt_policy: str = "hidden_unused"
    ruleset: str = "callbreak-v1"

    def __post_init__(self) -> None:
        if type(self.player_count) is not int or self.player_count not in (4, 5):
            raise ValueError("Choose four or five players.")
        if type(self.deals_per_match) is not int or self.deals_per_match != 5:
            raise ValueError("A match contains exactly five deals.")
        if not isinstance(self.redeal_policy, RedealPolicy):
            raise ValueError("A RedealPolicy is required.")
        if self.undealt_policy != "hidden_unused" or self.ruleset != "callbreak-v1":
            raise ValueError("Unsupported ruleset or undealt-card policy.")

    @property
    def players(self) -> tuple[int, ...]:
        return tuple(range(1, self.player_count + 1))

    @property
    def tricks_per_deal(self) -> int:
        return 52 // self.player_count


def advance(player: int, count: int, steps: int = 1) -> int:
    return (player - 1 + steps) % count + 1
