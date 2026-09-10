"""Standalone Call Break match, deal and trick rules. No platform dependencies."""

from .models import Play, Trick
from .rules import PlayRejection, current_winner, legal_cards, resolve_trick, validate_play
from .commands import AcceptHand, ClaimRedeal, PlaceBid, PlayCard, Redeal, StartDeal
from .commands import PrepareDeal, ShuffleDeck, CompleteShuffle, CutDeck, SkipCut, StartDistribution
from .config import GameConfig
from .engine import apply_control, apply_player, available_cards, create_match
from .events import Transition
from .game import MatchState, Phase
from .house_rules import RedealPolicy
from .views import player_view, public_view
from .queries import GameQuery

__all__ = [
    "Play", "Trick", "PlayRejection", "current_winner", "legal_cards",
    "resolve_trick", "validate_play",
    "AcceptHand", "ClaimRedeal", "PlaceBid", "PlayCard", "Redeal", "StartDeal",
    "PrepareDeal", "ShuffleDeck", "CompleteShuffle", "CutDeck", "SkipCut", "StartDistribution",
    "GameConfig", "apply_control", "apply_player", "available_cards", "create_match",
    "Transition", "MatchState", "Phase", "RedealPolicy", "player_view", "public_view", "GameQuery",
]
