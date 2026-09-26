"""Build detached hosted runtimes from a checkpoint and a complete receipt view.

No ownership is acquired and no host registry is modified here. The database
loader must obtain checkpoint and receipt data from one consistent committed view;
the ownership layer must fence and authorize activation separately.
"""
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from pydantic import TypeAdapter, model_validator

from app.adapters.flush import FlushAdapter
from app.adapters.marriage import MarriageAdapter
from app.models.action import CommandId, ReliableActionCommand
from app.runtime.command_runtime import CommandAccessError, CommandSession, request_fingerprint
from app.test_games.flush import HostedFlushTarget
from app.test_games.marriage import HostedMarriageTarget
from app.test_games.service import HostedGame
from flush import FlushGameEngine, FlushRulesConfig
from marriage import MarriageGameEngine
from marriage.scoring_rules import ScoringRules

from .checkpoints import (
    CheckpointError, Identity, Nonnegative, Positive, Record, canonical_json,
    capture_checkpoint, decode_checkpoint, restore_table_state,
)
from .hosted import HostedEngineDefinition


class ReceiptOutcome(Record):
    command_id: CommandId
    status: Literal['accepted', 'rejected']
    revision: Nonnegative
    detail: str | None = None


class RecoveryReceipt(Record):
    actor_id: Identity
    request: ReliableActionCommand
    fingerprint: str
    outcome: ReceiptOutcome

    @model_validator(mode='after')
    def matches_original_request(self):
        if self.outcome.command_id != self.request.command_id:
            raise ValueError('Receipt command ID mismatch.')
        if self.fingerprint != request_fingerprint(self.request):
            raise ValueError('Receipt fingerprint is not the original request fingerprint.')
        if self.outcome.status == 'accepted' and self.outcome.revision < self.request.expected_revision:
            raise ValueError('Accepted receipt predates its request revision.')
        return self


class ReceiptSnapshot(Record):
    match_id: Identity
    revision: Nonnegative
    # Explicit count/limit prevent silently dropping entries or resetting a full
    # session. The store must supply the count from the same snapshot as the rows.
    receipt_count: Nonnegative
    receipt_limit: Positive
    receipts: tuple[RecoveryReceipt, ...]

    @model_validator(mode='after')
    def complete_consistent_view(self):
        if self.receipt_count != len(self.receipts) or self.receipt_count > self.receipt_limit:
            raise ValueError('Incomplete or over-capacity receipt snapshot.')
        keys = set()
        for receipt in self.receipts:
            key = receipt.actor_id, receipt.request.command_id
            if key in keys:
                raise ValueError('Duplicate receipt identity.')
            keys.add(key)
            if receipt.request.match_id != self.match_id or receipt.outcome.revision > self.revision:
                raise ValueError('Receipt belongs to another match or a later state.')
        return self


@dataclass(frozen=True)
class RebuiltHost:
    game: HostedGame
    table_revision: int
    invitations: tuple[dict, ...]


def rebuild_hosted_game(host, checkpoint: dict, *, receipt_snapshot: dict) -> RebuiltHost:
    """Validate and reconstruct off-registry; a missing receipt view is an error.

    Returned games are NOT ready for routing: ownership, reservations, membership,
    durable scheduled work and activation must be established by the caller.
    """
    decoded = decode_checkpoint(checkpoint)
    data = decoded.record.data
    try:
        receipts = ReceiptSnapshot.model_validate_json(canonical_json(receipt_snapshot))
        revision = data.engine.revision if data.engine else 0
        if receipts.match_id != data.match_id or receipts.revision != revision:
            raise CheckpointError('Checkpoint and receipt snapshot do not identify the same state.')
        if data.engine is None and receipts.receipt_count:
            raise CheckpointError('A waiting lobby cannot contain gameplay receipts.')
        session = CommandSession(match_id=data.match_id, receipt_limit=receipts.receipt_limit)
        session.receipts = {
            (r.actor_id, r.request.command_id): (r.fingerprint, r.outcome.model_dump(exclude_none=True))
            for r in receipts.receipts
        }
        values = deepcopy(data.host.model_dump())
        values['users'] = list(values['users'])
        values['departed'] = set(values['departed'])
        values['pending_flush_departures'] = set(values['pending_flush_departures'])
        values['log'] = list(values['log'])
        values['marriage_moves'] = list(values['marriage_moves'])
        values['flush_rules'] = TypeAdapter(FlushRulesConfig).validate_json(
            canonical_json(values['flush_rules']), strict=True)
        values['marriage_scoring'] = TypeAdapter(ScoringRules).validate_json(
            canonical_json(values['marriage_scoring']), strict=True)
        if values['durable_game_id'] is not None:
            values['durable_game_id'] = UUID(values['durable_game_id'])
        game = HostedGame(room_id=data.room_id, capacity=data.capacity, name=data.name,
                          game_type=data.game_type, commands=session, table=restore_table_state(decoded), **values)
        state = decoded.engine_state
        if state is not None:
            if data.game_type == 'callbreak':
                game.state = state
            elif data.game_type == 'marriage':
                adapter = MarriageAdapter(MarriageGameEngine.from_state(state), match_id=data.match_id,
                                          owner_player_id=data.engine.owner_player_id)
                game.marriage_target = HostedMarriageTarget(host, game, adapter)
            else:
                adapter = FlushAdapter(FlushGameEngine.from_state(state), match_id=data.match_id,
                                       owner_player_id=data.engine.owner_player_id)
                historical_seats = {u: str(seat) for u, seat in game.flush_seats.items()
                                    if str(seat) in state.config.player_ids}
                game.flush_target = HostedFlushTarget(host, game, adapter, seat_by_user=historical_seats)
        if game.durable_game_id is not None:
            game.durable_definition = HostedEngineDefinition(game.game_type)
        # This catches metadata/position disagreements that otherwise silently
        # change seat meaning when HostedGame and its TableState are recombined.
        rebuilt = capture_checkpoint(game, table_revision=data.table_revision, invitations=data.invitations)
        if rebuilt != decoded.record.model_dump(mode='json'):
            raise CheckpointError('Rebuilt host does not reproduce the checkpoint exactly.')
        return RebuiltHost(game, data.table_revision, deepcopy(data.invitations))
    except CheckpointError:
        raise
    except (ValueError, TypeError, KeyError, IndexError) as error:
        raise CheckpointError(f'Cannot rebuild hosted game: {error}') from error


def lookup_recovered_receipt(game: HostedGame, actor_id: str, command: ReliableActionCommand) -> dict | None:
    """Trusted status lookup, including ended matches; returns no game/private view.

    A future authenticated status endpoint must derive actor_id from credentials
    and recheck access before calling. Never use a client-supplied actor identity.
    """
    if command.match_id != game.match_id:
        raise CommandAccessError(409, 'Receipt request belongs to a different match.')
    prior = game.commands.receipts.get((actor_id, command.command_id))
    if prior is None:
        return None
    fingerprint, receipt = prior
    if fingerprint != request_fingerprint(command):
        raise CommandAccessError(409, 'Command ID already used for a different request.')
    return deepcopy(receipt)
