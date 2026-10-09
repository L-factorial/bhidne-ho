from dataclasses import dataclass, field

from .house_rules import RedealPolicy
from .match_rules import MatchRules


@dataclass(frozen=True)
class GameConfig:
    player_count: int = 4
    deals_per_match: int = 5
    redeal_policy: RedealPolicy = field(default_factory=RedealPolicy)
    undealt_policy: str = "hidden_unused"
    ruleset: str = "callbreak-v1"
    match_rules: MatchRules | None = None

    def __post_init__(self) -> None:
        if type(self.player_count) is not int or self.player_count not in (4, 5):
            raise ValueError("Choose four or five players.")
        if type(self.deals_per_match) is not int or self.deals_per_match != 5:
            raise ValueError("A match contains exactly five deals.")
        if not isinstance(self.redeal_policy, RedealPolicy):
            raise ValueError("A RedealPolicy is required.")
        if self.undealt_policy != "hidden_unused" or self.ruleset != "callbreak-v1":
            raise ValueError("Unsupported ruleset or undealt-card policy.")
        if self.match_rules is not None:
            if not isinstance(self.match_rules, MatchRules):
                raise ValueError('Invalid match rules.')
            self.match_rules.validate_for(self.player_count)

    @property
    def score_scale(self) -> int:
        return self.match_rules.score_scale if self.match_rules else 10

    @property
    def players(self) -> tuple[int, ...]:
        return tuple(range(1, self.player_count + 1))

    @property
    def tricks_per_deal(self) -> int:
        return 52 // self.player_count


def advance(player: int, count: int, steps: int = 1) -> int:
    return (player - 1 + steps) % count + 1
