"""Standalone Marriage domain, deterministic startup, and draw/discard turns."""
from card_utils import Rank, Suit
from .cards import CardIdentity, PhysicalCard
from .deck import create_deck, validate_deck
from .enums import (AceSequencePolicy, ActionKind, CardType, DrawSource, GameStatus,
                    MaalNeighborPolicy, MeldType, QualificationRoute, TurnPhase)
from .errors import (CardConservationError, InvalidActionError, InvalidMeldError,
                     InvalidTurnError, MarriageError, NoDrawableCardError,
                     TipluUnavailableError, UnsupportedRuleError)
from .models import MarriageConfig, MarriageGameState, Meld, PlayerState
from .engine import MarriageGameEngine
from .events import (ActionResult, CardDiscarded, CardDrawn, DiscardPileRecycled,
                     DomainEvent, GameStarted, TurnChanged)
from .queries import AllowedActions, BlockedDrawSource, PlayerView, PublicGameView, PublicPlayerView
from .invariants import validate_card_conservation, validate_game_state
from .rank_policy import adjacent_maal_ranks, sequence_rank_order
from .rules import MarriageRules
from .scoring_rules import ScoringRules, SCORING_PRESETS
from .scoring import RoundScore, PlayerScore, ScoreItem
from .completion import Capability
from .maal import MaalView
from .visibility import VisibleEvent
from .events import MeldsShown, PlayerFinished, PlayerSawMaal, TipluRevealed

__all__ = [
    "ScoringRules", "SCORING_PRESETS", "RoundScore", "PlayerScore", "ScoreItem",
    "Rank", "Suit", "CardIdentity", "PhysicalCard", "create_deck", "validate_deck",
    "AceSequencePolicy", "CardType", "DrawSource", "GameStatus", "MaalNeighborPolicy",
    "MeldType", "QualificationRoute", "TurnPhase", "MarriageConfig", "Meld",
    "PlayerState", "MarriageRules", "adjacent_maal_ranks", "sequence_rank_order",
    "MarriageError", "CardConservationError", "InvalidActionError", "InvalidMeldError",
    "InvalidTurnError", "NoDrawableCardError", "TipluUnavailableError", "UnsupportedRuleError",
    "MarriageGameEngine", "MarriageGameState", "ActionResult", "DomainEvent",
    "GameStarted", "TurnChanged", "PlayerView", "PublicGameView", "PublicPlayerView",
    "validate_card_conservation",
    "ActionKind", "AllowedActions", "BlockedDrawSource", "CardDrawn", "CardDiscarded",
    "DiscardPileRecycled", "validate_game_state",
    "Capability", "MaalView", "VisibleEvent", "MeldsShown", "PlayerFinished",
    "PlayerSawMaal", "TipluRevealed",
]
