"""Versioned, trusted-only hosted checkpoints. Never send these to clients.

These pure codecs do not register games, acquire ownership, start timers, or restore
receipts. The caller must hold the game lock while capturing. SQL stores will split
the table metadata/positions and engine checkpoint into their respective records.
"""
from dataclasses import dataclass, replace
from copy import deepcopy
import hashlib
import json
from typing import Annotated, Any, Literal, get_args
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, model_validator

from callbreak import MatchState
from callbreak.audit import audit_match
from flush.models import FlushGameState
from flush.invariants import validate_game_state as validate_flush
from flush.errors import FlushError
from flush import FlushRulesConfig
from marriage.models import MarriageGameState
from marriage.events import DomainEvent as MarriageEvent
from marriage.invariants import validate_game_state as validate_marriage
from marriage.errors import MarriageError
from marriage.scoring_rules import ScoringRules
from app.multiplayer.table import SeatOffer, TableState


class CheckpointError(ValueError):
    """Unsupported or invalid recovery data; never silently create a new game."""


Nonnegative = Annotated[int, Field(ge=0)]
Positive = Annotated[int, Field(gt=0)]
Identity = Annotated[str, Field(min_length=1)]
GameType = Literal['callbreak', 'marriage', 'flush']
_JSON = TypeAdapter(Any)
_STATES = {'callbreak': TypeAdapter(MatchState), 'marriage': TypeAdapter(MarriageGameState),
           'flush': TypeAdapter(FlushGameState)}
_MARRIAGE_EVENTS = {kind.__name__: TypeAdapter(kind) for kind in get_args(MarriageEvent)}


def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


class Record(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True, allow_inf_nan=False)


class Position(Record):
    user_id: Identity
    seat: Positive | None
    queue_position: Positive | None

    @model_validator(mode='after')
    def one_position(self):
        if (self.seat is None) == (self.queue_position is None):
            raise ValueError('Exactly one seat or queue position is required.')
        return self


class Offer(Record):
    offer_id: Identity
    game_id: Identity
    seat_id: Positive
    leaving_player_id: Identity
    offered_to_player_id: Identity
    created_at: float
    expires_at: float
    status: Literal['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED']

    @model_validator(mode='after')
    def valid_deadline(self):
        if self.expires_at <= self.created_at or self.leaving_player_id == self.offered_to_player_id:
            raise ValueError('Invalid seat offer.')
        return self


class TableDetails(Record):
    next_seat_count: Nonnegative | None
    retired_next_seats: tuple[str | None, ...] | None
    releases: dict[str, str]
    offers: tuple[Offer, ...]
    events: tuple[dict[str, JsonValue], ...]
    offer_seconds: Annotated[float, Field(gt=0)]
    published_sequence: Nonnegative


class HostDetails(Record):
    users: tuple[Identity, ...]
    previous_match_id: str | None
    departed: tuple[Identity, ...]
    pending_flush_departures: tuple[Identity, ...]
    rule_proposal: dict[str, JsonValue] | None
    settings: dict[str, JsonValue]
    play_mode: Literal['manual']
    ended: bool
    error: str | None
    log: tuple[dict[str, JsonValue], ...]
    flush_seats: dict[str, Positive]
    flush_rules: dict[str, JsonValue]
    flush_rules_revision: Nonnegative
    flush_queries: dict[str, JsonValue]
    marriage_scoring: dict[str, JsonValue]
    marriage_queries: dict[str, JsonValue]
    marriage_moves: tuple[dict[str, JsonValue], ...]
    durable_game_id: str | None


class EngineCheckpoint(Record):
    engine_version: Literal[1]
    state_schema_version: Literal[1]
    revision: Nonnegative
    state: dict[str, JsonValue]
    history_types: tuple[str, ...]
    owner_player_id: str | None


class RecoveryData(Record):
    room_id: Identity
    table_id: Identity
    match_id: Identity
    game_type: GameType
    name: Annotated[str, Field(min_length=1, max_length=60)]
    capacity: Annotated[int, Field(ge=2)]
    table_revision: Nonnegative
    phase: Literal['OPEN', 'LOCKED', 'STARTED', 'COMPLETED', 'ENDED']
    positions: tuple[Position, ...]
    table: TableDetails
    host: HostDetails
    invitations: tuple[dict[str, JsonValue], ...]
    engine: EngineCheckpoint | None

    @model_validator(mode='after')
    def validate_identity_and_positions(self):
        UUID(self.table_id)
        UUID(self.match_id)
        if self.host.durable_game_id is not None:
            UUID(self.host.durable_game_id)
        if len(set(self.host.users)) != len(self.host.users) or len(self.host.users) > self.capacity:
            raise ValueError('Invalid historical roster.')
        users, seats, queue = set(), set(), set()
        for position in self.positions:
            if position.user_id in users:
                raise ValueError('Duplicate user position.')
            users.add(position.user_id)
            if position.seat is not None:
                # Flush seat IDs are stable historical IDs; replacements can
                # exceed table capacity even though occupancy remains bounded.
                if position.seat in seats or (self.game_type != 'flush' and position.seat > self.capacity):
                    raise ValueError('Duplicate or out-of-range seat.')
                seats.add(position.seat)
            else:
                if position.queue_position in queue:
                    raise ValueError('Duplicate queue position.')
                queue.add(position.queue_position)
        if len(seats) > self.capacity:
            raise ValueError('Too many occupied seats.')
        if self.table.next_seat_count is not None and self.table.next_seat_count > self.capacity:
            raise ValueError('Invalid replacement roster length.')
        if self.table.next_seat_count is not None and any(seat > self.table.next_seat_count for seat in seats):
            raise ValueError('Seat exceeds replacement roster length.')
        if self.host.ended and seats:
            raise ValueError('Ended tables cannot hold current seats.')
        if self.table.retired_next_seats is not None:
            if not self.host.ended or len(self.table.retired_next_seats) != self.table.next_seat_count:
                raise ValueError('Invalid retired replacement roster.')
        elif self.host.ended and self.table.next_seat_count is not None:
            raise ValueError('Ended table is missing its historical replacement roster.')
        if len(set(self.host.flush_seats.values())) != len(self.host.flush_seats):
            raise ValueError('Duplicate historical Flush seat identity.')
        for seat in self.table.releases:
            if not seat.isascii() or not seat.isdigit() or str(int(seat)) != seat or not 1 <= int(seat) <= self.capacity:
                raise ValueError('Invalid released seat.')
        if len({o.offer_id for o in self.table.offers}) != len(self.table.offers):
            raise ValueError('Duplicate offer identity.')
        for offer in self.table.offers:
            if offer.game_id != self.match_id or offer.seat_id > self.capacity:
                raise ValueError('Offer belongs to a different match or seat.')
        if self.table.published_sequence > len(self.table.events):
            raise ValueError('Table delivery cursor exceeds event history.')
        for sequence, event in enumerate(self.table.events, 1):
            if type(event.get('sequence')) is not int or event['sequence'] != sequence:
                raise ValueError('Noncontiguous table event history.')
        for invitation in self.invitations:
            if invitation.get('room_id') != self.room_id or invitation.get('match_id') != self.match_id:
                raise ValueError('Invitation belongs to another table match.')
        if self.engine is None and self.phase in ('STARTED', 'COMPLETED'):
            raise ValueError('Started table is missing engine state.')
        return self


class Checkpoint(Record):
    schema_version: Literal[1]
    data: RecoveryData
    digest: Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]


@dataclass(frozen=True)
class DecodedCheckpoint:
    record: Checkpoint
    engine_state: MatchState | MarriageGameState | FlushGameState | None


def _decode_engine(data):
    # Stored rule sets must reconstruct independently of today's defaults.
    for rule_type, value in ((FlushRulesConfig, data.host.flush_rules), (ScoringRules, data.host.marriage_scoring)):
        rule_adapter = TypeAdapter(rule_type)
        rules = rule_adapter.validate_json(canonical_json(value), strict=True)
        if rule_adapter.dump_python(rules, mode='json') != value:
            raise CheckpointError('Stored rules did not decode losslessly.')
    checkpoint = data.engine
    if checkpoint is None:
        return None
    adapter = _STATES[data.game_type]
    raw = dict(checkpoint.state)
    if data.game_type == 'marriage':
        history = raw.get('history', [])
        if len(history) != len(checkpoint.history_types):
            raise CheckpointError('Marriage history type count mismatch.')
        events = []
        for name, value in zip(checkpoint.history_types, history):
            if name not in _MARRIAGE_EVENTS:
                raise CheckpointError('Unsupported Marriage event type.')
            event_adapter = _MARRIAGE_EVENTS[name]
            event = event_adapter.validate_json(canonical_json(value), strict=True)
            if event_adapter.dump_python(event, mode='json') != value:
                raise CheckpointError('Marriage event did not decode losslessly.')
            events.append(event)
        raw['history'] = []
        state = replace(adapter.validate_json(canonical_json(raw), strict=True), history=tuple(events))
        validate_marriage(state)
    else:
        if checkpoint.history_types:
            raise CheckpointError('Unexpected event type metadata.')
        state = adapter.validate_json(canonical_json(raw), strict=True)
        if data.game_type == 'flush':
            validate_flush(state)
        else:
            audit_match(state)
    if adapter.dump_python(state, mode='json') != checkpoint.state or state.revision != checkpoint.revision:
        raise CheckpointError('Engine state did not decode losslessly at its recorded revision.')
    if data.game_type == 'callbreak':
        if len(data.host.users) != state.config.player_count or checkpoint.owner_player_id is not None:
            raise CheckpointError('Call Break host roster mismatch.')
    else:
        seats = (tuple(str(data.host.flush_seats[u]) for u in data.host.users) if data.game_type == 'flush'
                 else tuple(str(i + 1) for i in range(len(data.host.users))))
        # A finished Flush engine retains the previous round roster while the
        # open table accepts replacements. Its full historical mapping survives.
        if data.game_type == 'flush' and state.status.value == 'finished':
            seats = tuple(str(seat) for seat in data.host.flush_seats.values())
            roster_valid = set(state.config.player_ids).issubset(seats)
        else:
            roster_valid = seats == state.config.player_ids
        if not roster_valid or checkpoint.owner_player_id not in state.config.player_ids:
            raise CheckpointError('Adapter roster or owner mismatch.')
    return state


def restore_table_state(decoded: DecodedCheckpoint) -> TableState:
    """Rebuild only table mechanics; no registration, expiry checks, or tasks."""
    data = decoded.record.data
    next_seats = None
    if data.table.next_seat_count is not None:
        next_seats = (list(data.table.retired_next_seats) if data.table.retired_next_seats is not None
                      else [None] * data.table.next_seat_count)
        for position in data.positions:
            if position.seat is not None:
                next_seats[position.seat - 1] = position.user_id
    return TableState(
        table_id=data.table_id,
        queue=[p.user_id for p in sorted((p for p in data.positions if p.queue_position is not None),
                                         key=lambda p: p.queue_position)],
        phase=data.phase, next_seats=next_seats,
        releases={int(seat): user for seat, user in data.table.releases.items()},
        offers={offer.offer_id: SeatOffer(**offer.model_dump()) for offer in data.table.offers},
        events=deepcopy(list(data.table.events)), offer_seconds=data.table.offer_seconds,
        published_sequence=data.table.published_sequence,
    )


def decode_checkpoint(value: dict) -> DecodedCheckpoint:
    """Validate a detached checkpoint without acquiring ownership or serving it."""
    try:
        if not isinstance(value, dict) or type(value.get('schema_version')) is not int or value['schema_version'] != 1:
            raise CheckpointError('Unsupported checkpoint schema version.')
        record = Checkpoint.model_validate_json(canonical_json(value))
        digest = hashlib.sha256(canonical_json(record.data.model_dump(mode='json')).encode()).hexdigest()
        if digest != record.digest:
            raise CheckpointError('Checkpoint digest mismatch.')
        return DecodedCheckpoint(record, _decode_engine(record.data))
    except CheckpointError:
        raise
    except (ValueError, TypeError, KeyError, IndexError, FlushError, MarriageError) as error:
        raise CheckpointError(f'Invalid checkpoint: {error}') from error


def capture_checkpoint(game, *, table_revision: int, invitations=()) -> dict:
    """Capture under the host lock. No views, randomness, I/O, or timers run here."""
    if game.deadline is not None:
        raise CheckpointError('Legacy process deadline must be migrated to an absolute scheduled action first.')
    if game.game_type not in _STATES:
        raise CheckpointError('Unsupported game type.')
    positions = []
    for seat, user in enumerate([] if game.ended else game.table.seats(game), 1):
        if user is not None:
            positions.append({'user_id': user, 'seat': game.flush_seats[user] if game.game_type == 'flush' else seat,
                              'queue_position': None})
    positions.extend({'user_id': user, 'seat': None, 'queue_position': i}
                     for i, user in enumerate(game.table.queue, 1))
    positions.sort(key=lambda p: (p['seat'] is None, p['seat'] or p['queue_position']))
    engine = None
    target = game.flush_target if game.game_type == 'flush' else game.marriage_target
    state = game.state if game.game_type == 'callbreak' else target.adapter.checkpoint().get_state() if target else None
    if state is not None:
        engine = {'engine_version': 1, 'state_schema_version': 1, 'revision': state.revision,
                  'state': _STATES[game.game_type].dump_python(state, mode='json'),
                  'history_types': [type(e).__name__ for e in state.history] if game.game_type == 'marriage' else [],
                  'owner_player_id': target.adapter.owner_player_id if target else None}
    host = {name: getattr(game, name) for name in HostDetails.model_fields}
    host['departed'] = sorted(game.departed)
    host['pending_flush_departures'] = sorted(game.pending_flush_departures)
    host['durable_game_id'] = str(game.durable_game_id) if game.durable_game_id else None
    raw = _JSON.dump_python({
        'room_id': game.room_id, 'table_id': game.table.table_id, 'match_id': game.match_id,
        'game_type': game.game_type, 'name': game.name, 'capacity': game.capacity,
        'table_revision': table_revision, 'phase': game.table.phase,
        'positions': positions, 'host': host, 'engine': engine, 'invitations': list(invitations),
        'table': {'next_seat_count': len(game.table.next_seats) if game.table.next_seats is not None else None,
                  'retired_next_seats': game.table.next_seats if game.ended else None,
                  'releases': {str(k): v for k, v in game.table.releases.items()},
                  'offers': list(game.table.offers.values()), 'events': game.table.events,
                  'offer_seconds': game.table.offer_seconds, 'published_sequence': game.table.published_sequence},
    }, mode='json')
    # Normalize once through the strict schema so output, checksum and decoding
    # agree on float/tuple representations and never retain mutable host references.
    try:
        data = RecoveryData.model_validate_json(canonical_json(raw)).model_dump(mode='json')
    except (ValueError, TypeError) as error:
        raise CheckpointError(f'Invalid hosted state: {error}') from error
    result = {'schema_version': 1, 'data': data,
              'digest': hashlib.sha256(canonical_json(data).encode()).hexdigest()}
    decode_checkpoint(result)
    return result
