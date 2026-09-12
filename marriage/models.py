"""Immutable domain values and trusted round snapshots."""
from dataclasses import dataclass, field

from .cards import PhysicalCard
from .enums import GameStatus, MeldType, QualificationRoute, TurnPhase
from .events import DomainEvent
from .rules import MarriageRules


def _player_id(value: str) -> None:
    if not isinstance(value, str) or not value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("Player IDs must be nonempty strings without control characters.")


@dataclass(frozen=True)
class MarriageConfig:
    player_ids: tuple[str, ...]
    rules: MarriageRules = field(default_factory=MarriageRules)
    first_player_id: str | None = None

    def __post_init__(self):
        if isinstance(self.player_ids, (str, bytes)):
            raise ValueError("Supply a sequence of player IDs, not one string.")
        object.__setattr__(self, "player_ids", tuple(self.player_ids))
        if not isinstance(self.rules, MarriageRules):
            raise ValueError("Configuration requires MarriageRules.")
        if not self.rules.min_players <= len(self.player_ids) <= self.rules.max_players:
            raise ValueError("Marriage supports two through five players.")
        for player_id in self.player_ids:
            _player_id(player_id)
        if len(set(self.player_ids)) != len(self.player_ids):
            raise ValueError("Player IDs must be unique.")
        if self.first_player_id is None:
            object.__setattr__(self, "first_player_id", self.player_ids[0])
        elif self.first_player_id not in self.player_ids:
            raise ValueError("First player must be one of the configured seats.")


@dataclass(frozen=True)
class Meld:
    """A structural declaration, not proof of a valid sequence, Tunnela or Dublee."""
    meld_type: MeldType
    card_ids: tuple[str, ...]

    def __post_init__(self):
        if not isinstance(self.meld_type, MeldType) or isinstance(self.card_ids, (str, bytes)):
            raise ValueError("Meld requires a MeldType and sequence of card IDs.")
        object.__setattr__(self, "card_ids", tuple(self.card_ids))
        if not self.card_ids or any(not isinstance(value, str) or not value for value in self.card_ids):
            raise ValueError("Meld card IDs must be nonempty strings.")
        if len(set(self.card_ids)) != len(self.card_ids):
            raise ValueError("A physical card cannot be repeated within a meld.")


@dataclass(frozen=True)
class PlayerState:
    player_id: str
    hand: tuple[PhysicalCard, ...] = ()
    route: QualificationRoute = QualificationRoute.UNQUALIFIED
    shown_melds: tuple[Meld, ...] = ()
    committed_card_ids: frozenset[str] = frozenset()
    has_seen_maal: bool = False
    finished: bool = False

    def __post_init__(self):
        _player_id(self.player_id)
        if not isinstance(self.route, QualificationRoute):
            raise ValueError("Player route must be a QualificationRoute.")
        if type(self.has_seen_maal) is not bool or type(self.finished) is not bool:
            raise ValueError("Player flags must be booleans.")
        object.__setattr__(self, "hand", tuple(self.hand))
        object.__setattr__(self, "shown_melds", tuple(self.shown_melds))
        if isinstance(self.committed_card_ids, (str, bytes)):
            raise ValueError("Committed IDs must be a collection, not a string.")
        object.__setattr__(self, "committed_card_ids", frozenset(self.committed_card_ids))
        if any(not isinstance(card, PhysicalCard) for card in self.hand):
            raise ValueError("Hand entries must be physical cards.")
        owned = {card.card_id for card in self.hand}
        if len(owned) != len(self.hand):
            raise ValueError("Hand contains duplicate physical IDs.")
        if any(not isinstance(meld, Meld) for meld in self.shown_melds):
            raise ValueError("Shown declarations must be Meld values.")
        shown = tuple(card_id for meld in self.shown_melds for card_id in meld.card_ids)
        if len(set(shown)) != len(shown):
            raise ValueError("Shown melds cannot reuse a physical card.")
        if set(shown) != self.committed_card_ids or not self.committed_card_ids <= owned:
            raise ValueError("Committed cards must exactly match shown melds and remain owned.")

    @property
    def initial_melds_shown(self) -> bool:
        return self.route == QualificationRoute.NORMAL

    @property
    def dublee_mode(self) -> bool:
        return self.route == QualificationRoute.DUBLEE


@dataclass(frozen=True)
class MarriageGameState:
    """Trusted snapshot; never send this full state to a player."""
    config: MarriageConfig
    players: tuple[PlayerState, ...]
    stock: tuple[PhysicalCard, ...] = ()
    discard: tuple[PhysicalCard, ...] = ()
    current_seat: int | None = None
    phase: TurnPhase | None = None
    status: GameStatus = GameStatus.WAITING
    tiplu: PhysicalCard | None = None
    must_finish: bool = False
    winner: str | None = None
    winning_pair: tuple[str, ...] = ()
    revision: int = 0
    history: tuple[DomainEvent, ...] = ()

    def __post_init__(self):
        for name in ("players", "stock", "discard", "history", "winning_pair"):
            object.__setattr__(self, name, tuple(getattr(self, name)))

    @property
    def current_player_id(self) -> str | None:
        if self.current_seat is None:
            return None
        return self.players[self.current_seat].player_id
