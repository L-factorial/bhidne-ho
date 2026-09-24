"""Explicit safe projections: no trusted history or hidden ownership locations."""
from dataclasses import dataclass

from .cards import PhysicalCard
from .scoring import RoundScore, calculate_scores
from .scoring_rules import ScoringRules
from .enums import ActionKind, DrawSource, GameStatus, QualificationRoute, TurnPhase
from .errors import InvalidActionError
from .models import MarriageGameState, Meld, NormalFinish
from .completion import eighth_pair, normal_finish
from .maal import MaalView, maal_view
from .turns import discardable_ids, draw_source_block, find_player, turn_block, tunnela_declarations_pending


@dataclass(frozen=True)
class BlockedDrawSource:
    source: DrawSource
    reason: str


@dataclass(frozen=True)
class AllowedActions:
    kinds: tuple[ActionKind, ...] = ()
    drawable_sources: tuple[DrawSource, ...] = ()
    discardable_card_ids: tuple[str, ...] = ()
    blocked_sources: tuple[BlockedDrawSource, ...] = ()
    reason: str | None = None
    normal_finish_unavailable_reason: str | None = None
    normal_finish: NormalFinish | None = None


def allowed_actions(state: MarriageGameState, player_id: str) -> AllowedActions:
    player = find_player(state, player_id)
    if player.folded:
        return AllowedActions(reason="Player has folded.")
    if tunnela_declarations_pending(state):
        return AllowedActions(kinds=() if player.tunnela_declared else (ActionKind.DECLARE_TUNNELAS,),
                              reason="Waiting for initial Tunnela declarations.")
    fold = (ActionKind.FOLD,) if state.status is GameStatus.IN_PROGRESS else ()
    if (state.status is GameStatus.IN_PROGRESS and state.current_player_id == player_id
            and state.must_finish):
        return AllowedActions(kinds=(ActionKind.FINISH, ActionKind.FOLD) if eighth_pair(player) else fold,
                              reason="Winning discard requires finishing.")
    reason = turn_block(state, player_id)
    if reason:
        return AllowedActions(kinds=fold, reason=reason)
    if state.phase is TurnPhase.MUST_DRAW:
        sources = []
        blocked = []
        for source in DrawSource:
            reason = draw_source_block(state, player, source)
            if reason:
                blocked.append(BlockedDrawSource(source, reason))
            else:
                sources.append(source)
        return AllowedActions(kinds=((ActionKind.DRAW,) if sources else ()) + fold,
                              drawable_sources=tuple(sources), blocked_sources=tuple(blocked))
    ids = discardable_ids(state, player)
    witness = normal_finish(player, state.tiplu, state.config.rules)
    kinds = [ActionKind.FOLD] + ([ActionKind.DISCARD] if ids else [])
    if player.route is QualificationRoute.UNQUALIFIED:
        kinds.extend((ActionKind.SHOW_INITIAL_MELDS, ActionKind.SHOW_DUBLEES))
    elif eighth_pair(player) or witness is not None:
        kinds.append(ActionKind.FINISH)
    return AllowedActions(kinds=tuple(kinds), discardable_card_ids=ids, normal_finish=witness)


@dataclass(frozen=True)
class PublicPlayerView:
    player_id: str
    hand_count: int
    route: QualificationRoute
    shown_melds: tuple[Meld, ...]
    has_seen_maal: bool
    finished: bool
    folded: bool = False
    tunnela_declared: bool = False
    initial_tunnelas: tuple[Meld, ...] = ()


@dataclass(frozen=True)
class PublicGameView:
    revision: int
    status: GameStatus
    players: tuple[PublicPlayerView, ...]
    current_player_id: str | None
    phase: TurnPhase | None
    stock_count: int
    top_discard: PhysicalCard | None
    winner: str | None
    scoring_rules: ScoringRules
    scores: RoundScore | None
    normal_finish: NormalFinish | None = None
    winning_pair: tuple[str, ...] = ()
    won_by_fold: bool = False
    tunnela_declaration_pending: bool = False


@dataclass(frozen=True)
class PlayerView:
    public: PublicGameView
    player_id: str
    hand: tuple[PhysicalCard, ...]
    actions: AllowedActions
    maal: MaalView | None


def public_view(state: MarriageGameState) -> PublicGameView:
    return PublicGameView(
        revision=state.revision, status=state.status,
        players=tuple(PublicPlayerView(p.player_id, len(p.hand), p.route,
                                      p.shown_melds, p.has_seen_maal, p.finished, p.folded, p.tunnela_declared, p.initial_tunnelas)
                      for p in state.players),
        current_player_id=state.current_player_id, phase=state.phase,
        stock_count=len(state.stock),
        top_discard=state.discard[-1] if state.discard else None, winner=state.winner,
        scoring_rules=state.config.rules.scoring, scores=calculate_scores(state),
        normal_finish=state.normal_finish, won_by_fold=state.won_by_fold,
        tunnela_declaration_pending=tunnela_declarations_pending(state),
        winning_pair=state.winning_pair if state.status is GameStatus.FINISHED else (),
    )


def player_view(state: MarriageGameState, player_id: str) -> PlayerView:
    for player in state.players:
        if player.player_id == player_id:
            return PlayerView(public_view(state), player_id, player.hand, allowed_actions(state, player_id),
                              maal_view(state.tiplu, state.config.rules) if player.has_seen_maal else None)
    raise InvalidActionError("Unknown player ID.")
