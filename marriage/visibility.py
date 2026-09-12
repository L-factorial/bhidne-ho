"""Allowlisted event projection; newly introduced events must opt in explicitly."""
from dataclasses import dataclass

from .cards import PhysicalCard
from .enums import DrawSource, MeldType, QualificationRoute, TurnPhase
from .errors import InvalidActionError
from .events import (CardDiscarded, CardDrawn, DiscardPileRecycled, GameStarted, MeldsShown,
                     PlayerFinished, PlayerSawMaal, TipluRevealed, TurnChanged)
from .models import MarriageGameState


@dataclass(frozen=True)
class VisibleEvent:
    sequence: int
    revision: int
    kind: str
    player_id: str | None = None
    player_ids: tuple[str, ...] = ()
    phase: TurnPhase | None = None
    source: DrawSource | None = None
    card: PhysicalCard | None = None
    card_count: int | None = None
    route: QualificationRoute | None = None
    meld_types: tuple[MeldType, ...] = ()
    card_groups: tuple[tuple[str, ...], ...] = ()
    winning_pair: tuple[str, ...] = ()


def visible_events(state: MarriageGameState, viewer: str | None, after: int) -> tuple[VisibleEvent, ...]:
    if type(after) is not int or after < 0:
        raise InvalidActionError("Event cursor must be a nonnegative sequence number.")
    entitled = any(p.player_id == viewer and p.has_seen_maal for p in state.players)
    result = []
    for event in state.history:
        if event.sequence <= after:
            continue
        fields = {}
        if isinstance(event, GameStarted):
            fields = dict(player_ids=event.player_ids, card_count=event.cards_per_player)
        elif isinstance(event, TurnChanged):
            fields = dict(player_id=event.player_id, phase=event.phase)
        elif isinstance(event, CardDrawn):
            fields = dict(player_id=event.player_id, source=event.source,
                          card=event.card if event.source is DrawSource.DISCARD or viewer == event.player_id else None)
        elif isinstance(event, CardDiscarded):
            fields = dict(player_id=event.player_id, card=event.card)
        elif isinstance(event, DiscardPileRecycled):
            fields = dict(card_count=event.card_count)
        elif isinstance(event, MeldsShown):
            fields = dict(player_id=event.player_id, route=event.route,
                          meld_types=event.meld_types, card_groups=event.card_groups)
        elif isinstance(event, TipluRevealed):
            fields = dict(card=event.card if entitled else None)
        elif isinstance(event, PlayerSawMaal):
            fields = dict(player_id=event.player_id)
        elif isinstance(event, PlayerFinished):
            fields = dict(player_id=event.player_id, winning_pair=event.winning_pair)
        else:
            raise InvalidActionError("Event has no safe visibility projection.")
        result.append(VisibleEvent(event.sequence, event.revision, event.kind, **fields))
    return tuple(result)
