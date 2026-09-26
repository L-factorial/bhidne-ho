"""Creator-controlled Call Break review continuation; deliberately no automatic timer."""
from pydantic import ValidationError
from callbreak import Phase

from app.games.base import GameCommandRejected
from .checkpoints import Record, Positive, canonical_json


class NextDealPayload(Record):
    deal_number: Positive


def next_deal(host, game, actor, request):
    if game.game_type != 'callbreak' or game.state is None or not host.round_summary_seconds:
        raise GameCommandRejected('REVIEW_UNAVAILABLE', 'This game does not have a manual deal review.')
    try:
        payload = NextDealPayload.model_validate_json(canonical_json(request.payload))
    except ValidationError as error:
        raise GameCommandRejected('INVALID_COMMAND', 'Provide the completed deal number.') from error
    if not game.users or actor != game.users[0]:
        raise GameCommandRejected('HOST_REQUIRED', 'Only the creator can start the next deal.')
    if (payload.deal_number != len(game.state.completed_deals)
            or game.state.phase == Phase.MATCH_COMPLETE):
        raise GameCommandRejected('STALE_DEAL', 'The round changed. Refresh the table.')
    # A new current-revision request for an already continued deal is harmless,
    # matching the legacy endpoint. Same-ID retries resolve their original receipt.
    if game.state.phase != Phase.DEAL_COMPLETE:
        return []
    return host._apply_controllers(game, advance_deal=True)
