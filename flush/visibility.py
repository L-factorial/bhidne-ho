"""Allowlisted public event projection. SEE_CARDS carries no private identities."""
from dataclasses import dataclass, asdict
from .errors import InvalidActionError
from .turns import find_player


@dataclass(frozen=True)
class VisibleEvent:
    sequence: int
    revision: int
    kind: str
    player_id: str | None
    amount: int
    winner_ids: tuple[str, ...]
    shown_hands: tuple[tuple[str, tuple[str, ...]], ...]

    target_player_id: str | None = None
    loser_player_id: str | None = None

    def to_dict(self):
        return asdict(self)


def visible_events(state, viewer=None, after=0):
    if type(after) is not int or after < 0:
        raise InvalidActionError('Event cursor must be a nonnegative integer.')
    if viewer is not None:
        find_player(state, viewer)
    result = []
    for event in state.history:
        if event.sequence <= after:
            continue
        if event.kind not in ('ROUND_STARTED', 'DEAL_REQUESTED', 'DECK_CUT', 'CUT_SKIPPED', 'CARDS_DEALT', 'GAME_STARTED', 'BOOT_COLLECTED', 'TURN_CHANGED', 'BET_PLACED',
                              'CARDS_SEEN', 'PLAYER_FOLDED', 'SHOW_REQUESTED', 'ROUND_FINISHED', 'SIDE_SHOW_REQUESTED', 'SIDE_SHOW_DECLINED', 'SIDE_SHOW_RESOLVED'):
            raise InvalidActionError('Event has no safe visibility projection.')
        hands = tuple((h.player_id, tuple(str(c) for c in h.cards)) for h in event.shown_hands) if event.kind in ('ROUND_FINISHED', 'SHOW_REQUESTED') else ()
        result.append(VisibleEvent(event.sequence, event.revision, event.kind, event.player_id,
                                   event.amount, event.winner_ids, hands, event.target_player_id, event.loser_player_id))
    return tuple(result)
