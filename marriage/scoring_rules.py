"""Explicit house scoring policy, independent of transports and UI."""
from dataclasses import dataclass, fields


@dataclass(frozen=True)
class ScoringRules:
    # Totals for one, two, or three copies (not a per-card multiplier).
    tiplu: tuple[int, int, int] = (3, 8, 15)
    jhiplu: tuple[int, int, int] = (2, 5, 10)
    poplu: tuple[int, int, int] = (2, 5, 10)
    man: tuple[int, int, int] = (2, 5, 10)
    marriage: tuple[int, int, int] = (10, 25, 50)
    tunnela_bonus: int = 5
    tunnela_scope: str = "shown"
    maal_requires_seen: bool = True
    seen_payment: int = 3
    unseen_payment: int = 10
    dublee_win_bonus: int = 5

    def __post_init__(self):
        for name in ("tiplu", "jhiplu", "poplu", "man", "marriage"):
            values = getattr(self, name)
            if not isinstance(values, (tuple, list)) or len(values) != 3:
                raise ValueError(f"{name} needs totals for one, two and three copies.")
            if any(type(v) is not int or not 0 <= v <= 1000 for v in values):
                raise ValueError("Scoring values must be whole numbers from 0 to 1000.")
            object.__setattr__(self, name, tuple(values))
        for name in ("tunnela_bonus", "seen_payment", "unseen_payment", "dublee_win_bonus"):
            value = getattr(self, name)
            if type(value) is not int or not 0 <= value <= 1000:
                raise ValueError("Scoring values must be whole numbers from 0 to 1000.")
        if self.tunnela_scope not in ("off", "shown", "hand"):
            raise ValueError("Tunnela scope must be off, shown or hand.")
        if type(self.maal_requires_seen) is not bool:
            raise ValueError("Maal eligibility must be boolean.")

    @classmethod
    def from_dict(cls, value):
        if not isinstance(value, dict) or set(value) - {f.name for f in fields(cls)}:
            raise ValueError("Unknown scoring option.")
        return cls(**value)


SCORING_PRESETS = {
    "house": ScoringRules(),
    "simple": ScoringRules(tiplu=(3, 6, 9), jhiplu=(2, 4, 6), poplu=(2, 4, 6),
                           man=(2, 4, 6), marriage=(0, 0, 0), tunnela_scope="off", dublee_win_bonus=0),
}
