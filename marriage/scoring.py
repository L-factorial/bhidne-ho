"""Deterministic final-round points. Never expose unfinished hand valuations."""
from collections import Counter
from dataclasses import dataclass

from .enums import GameStatus, MeldType, QualificationRoute
from .maal import maal_view
from .scoring_rules import ScoringRules


@dataclass(frozen=True)
class ScoreItem:
    label: str
    count: int
    points: int


@dataclass(frozen=True)
class PlayerScore:
    player_id: str
    has_seen_maal: bool
    eligible: bool
    items: tuple[ScoreItem, ...]
    maal_points: int
    maal_net: int
    winner_payment: int
    net_points: int


@dataclass(frozen=True)
class RoundScore:
    winner: str
    rules: ScoringRules
    total_maal: int
    players: tuple[PlayerScore, ...]


def score_items(player, maal, rules):
    if rules.maal_requires_seen and not player.has_seen_maal:
        return ()
    faces = Counter(c.identity for c in player.hand)
    counts = [faces[maal.tiplu], faces[maal.jhiplu], faces[maal.poplu]]
    tables = [rules.tiplu, rules.jhiplu, rules.poplu]
    def value(table, count):
        return table[count - 1] if count else 0
    # Find the highest-valued disjoint grouping. Marriage replaces its three
    # constituent cards; it never also receives their individual points.
    marriage_count = max(range(min(counts) + 1), key=lambda n:
                         value(rules.marriage, n) + sum(value(t, c - n) for t, c in zip(tables, counts)))
    items = []
    if marriage_count:
        items.append(ScoreItem("Marriage", marriage_count, value(rules.marriage, marriage_count)))
    for label, table, count in zip(("Tiplu", "Jhiplu", "Poplu", "Man"),
                                  (*tables, rules.man), (*[c - marriage_count for c in counts], faces[None])):
        if count:
            items.append(ScoreItem(label, count, value(table, count)))
    tunnelas = (sum(m.meld_type is MeldType.TUNNELA for m in player.shown_melds)
                if rules.tunnela_scope == "shown" else
                sum(count == 3 for face, count in faces.items() if face is not None)
                if rules.tunnela_scope == "hand" else 0)
    if tunnelas:
        items.append(ScoreItem("Tunnela bonus", tunnelas, tunnelas * rules.tunnela_bonus))
    return tuple(items)


def calculate_scores(state) -> RoundScore | None:
    """Final holdings include committed melds, exclude stock/discard/indicator.

    Maal settles pairwise. Each loser additionally pays the winner the selected
    seen/unseen rate and (when applicable) Dublee win bonus. Positive net wins.
    """
    if state.status is not GameStatus.FINISHED or state.winner is None:
        return None
    rules = state.config.rules.scoring
    maal = maal_view(state.tiplu, state.config.rules)
    items = [score_items(p, maal, rules) for p in state.players]
    points = [sum(item.points for item in row) for row in items]
    total = sum(points)
    winner = next(p for p in state.players if p.player_id == state.winner)
    extra = rules.dublee_win_bonus if winner.route is QualificationRoute.DUBLEE else 0
    payments = [0 if p.player_id == state.winner else
                -(rules.seen_payment if p.has_seen_maal else rules.unseen_payment) - extra for p in state.players]
    payments[state.config.player_ids.index(state.winner)] = -sum(payments)
    rows = tuple(PlayerScore(p.player_id, p.has_seen_maal, not rules.maal_requires_seen or p.has_seen_maal,
                             items[i], points[i], len(points) * points[i] - total, payments[i],
                             len(points) * points[i] - total + payments[i]) for i, p in enumerate(state.players))
    return RoundScore(state.winner, rules, total, rows)
