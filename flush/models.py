from dataclasses import dataclass
from card_utils import Card

from .enums import GameStatus, PlayerStatus, Visibility, TerminationReason
from .events import DomainEvent, ShownHand, ShownHand
from .evaluator import FlushHandResult
from .side_show import SideShowRequest, SideShowResult
from .rules import FlushRulesConfig, integer


@dataclass(frozen=True)
class FlushConfig:
    player_ids: tuple[str, ...]
    initial_chips: tuple[int, ...]
    rules: FlushRulesConfig
    dealer_id: str

    def __post_init__(self):
        if isinstance(self.player_ids, (str, bytes)):
            raise ValueError('Supply a sequence of player IDs.')
        object.__setattr__(self, 'player_ids', tuple(self.player_ids))
        object.__setattr__(self, 'initial_chips', tuple(self.initial_chips))
        if not isinstance(self.rules, FlushRulesConfig):
            raise ValueError('FlushRulesConfig is required.')
        if any(not isinstance(p, str) or not p.strip() for p in self.player_ids):
            raise ValueError('Player IDs must be nonempty strings.')
        if len(set(self.player_ids)) != len(self.player_ids):
            raise ValueError('Player IDs must be distinct.')
        if not self.rules.minimum_players <= len(self.player_ids) <= self.rules.maximum_players:
            raise ValueError('Player count is outside configured limits.')
        if self.dealer_id not in self.player_ids:
            raise ValueError('Dealer must occupy a seat.')
        if len(self.initial_chips) != len(self.player_ids):
            raise ValueError('Supply initial chips for every seat.')
        for chips in self.initial_chips:
            integer(chips, 'initial_chips')


@dataclass(frozen=True)
class PlayerState:
    player_id: str
    chips: int
    cards: tuple[Card, ...] = ()
    status: PlayerStatus = PlayerStatus.ACTIVE
    visibility: Visibility = Visibility.BLIND
    total_contribution: int = 0
    blind_bet_count: int = 0
    turn_bet_count: int = 0

    def __post_init__(self):
        object.__setattr__(self, 'cards', tuple(self.cards))


@dataclass(frozen=True)
class Payout:
    player_id: str
    amount: int


@dataclass(frozen=True)
class RoundSettlement:
    reason: TerminationReason
    winner_ids: tuple[str, ...]
    payouts: tuple[Payout, ...]
    shown_hands: tuple[ShownHand, ...] = ()
    winning_hand: FlushHandResult | None = None

    def __post_init__(self):
        for name in ('winner_ids', 'payouts', 'shown_hands'):
            object.__setattr__(self, name, tuple(getattr(self, name)))


@dataclass(frozen=True)
class ShowRequest:
    requester_id: str
    target_id: str


@dataclass(frozen=True)
class RoundResult:
    round_number: int
    winner_ids: tuple[str, ...]
    net_changes: tuple[Payout, ...]

    def __post_init__(self):
        object.__setattr__(self, 'winner_ids', tuple(self.winner_ids))
        object.__setattr__(self, 'net_changes', tuple(self.net_changes))


@dataclass(frozen=True)
class FlushGameState:
    config: FlushConfig
    players: tuple[PlayerState, ...]
    stock: tuple[Card, ...] = ()
    status: GameStatus = GameStatus.WAITING
    current_seat: int | None = None
    current_blind_bet: int = 0
    current_seen_bet: int = 0
    pot: int = 0
    revision: int = 0
    settlement: RoundSettlement | None = None
    pending_side_show: SideShowRequest | None = None
    pending_show: ShowRequest | None = None
    revealed_hands: tuple[ShownHand, ...] = ()
    side_shows: tuple[SideShowResult, ...] = ()
    history: tuple[DomainEvent, ...] = ()
    round_number: int = 1
    round_start_revision: int = 1
    round_results: tuple[RoundResult, ...] = ()

    def __post_init__(self):
        for name in ('players', 'stock', 'history', 'side_shows', 'round_results', 'revealed_hands'):
            object.__setattr__(self, name, tuple(getattr(self, name)))

    @property
    def current_player_id(self):
        return self.players[self.current_seat].player_id if self.current_seat is not None else None

    @property
    def held_pot(self):
        return 0 if self.settlement else self.pot
