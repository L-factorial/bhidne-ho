"""Transactional engine bridge. Identity mapping and delivery stay in the host."""
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from pydantic import TypeAdapter

from marriage import (CardConservationError, DrawSource, MarriageError, MarriageGameEngine,
                      Meld, MeldType)

from .contracts import (COMMAND_SPECS, CommandName, CommandRejected, Identifier, OutboundEvent,
                        PlayerCommand, RoutedEvent)

_JSON = TypeAdapter(Any)


def json_value(value):
    return _JSON.dump_python(value, mode="json")


@dataclass(frozen=True)
class AdapterResult:
    revision: int
    messages: tuple[RoutedEvent, ...]


class MarriageAdapter:
    """Owns the engine exclusively. A host serializes dispatch and supplies local seats."""
    def __init__(self, engine: MarriageGameEngine, *, match_id: str, owner_player_id: str):
        if owner_player_id not in engine.get_state().config.player_ids:
            raise ValueError("Owner must occupy a configured seat.")
        if not isinstance(match_id, str) or not match_id.strip() or len(match_id) > 128:
            raise ValueError("Invalid match ID.")
        for seat in engine.get_state().config.player_ids:
            TypeAdapter(Identifier).validate_python(seat)
        self._engine = deepcopy(engine)
        self.match_id, self.owner_player_id = match_id, owner_player_id
        self._registered = False

    @property
    def seat_ids(self):
        return self._engine.get_state().config.player_ids

    @property
    def revision(self):
        return self._engine.get_state().revision

    def snapshot(self, player_id: str | None = None):
        view = self._engine.get_public_view() if player_id is None else self._engine.get_player_view(player_id)
        return {"game_type": "marriage", "protocol_version": 1, "match_id": self.match_id,
                "revision": self.revision, "view": json_value(view)}

    def checkpoint(self):
        # Accepted calls replace the engine only; they never mutate an older checkpoint.
        return self._engine

    def restore(self, checkpoint):
        self._engine = checkpoint

    def dispatch_player(self, request: PlayerCommand, *, player_id: str) -> AdapterResult | CommandRejected:
        request = PlayerCommand.model_validate(request.model_dump(mode="json"))

        def reject(code, detail):
            return CommandRejected(match_id=self.match_id, command_id=request.command_id,
                                   current_revision=self.revision, code=code, detail=detail)

        if request.match_id != self.match_id:
            return reject("MATCH_MISMATCH", "Request belongs to another match.")
        if player_id not in self._engine.get_state().config.player_ids:
            return reject("UNKNOWN_PLAYER", "Spectators cannot submit player commands.")
        if request.expected_revision != self.revision:
            return reject("STALE_REVISION", "Refresh the game before retrying.")
        if request.command is CommandName.START_GAME and player_id != self.owner_player_id:
            return reject("OWNER_REQUIRED", "Only the game owner can start this round.")
        spec = COMMAND_SPECS[request.command]
        engine = deepcopy(self._engine) if spec.mutates else self._engine
        before_sequence = len(engine.get_state().history)
        payload = request.payload

        def meld(value):
            return Meld(MeldType(value["meld_type"]), tuple(value["card_ids"]))

        try:
            method = getattr(engine, spec.engine_method)
            if request.command in (CommandName.START_GAME, CommandName.READ_LAST_CARD):
                result = method()
            elif request.command is CommandName.DRAW_CARD:
                result = method(player_id, DrawSource(payload["source"]))
            elif request.command is CommandName.DISCARD_CARD:
                result = method(player_id, payload["card_id"])
            elif request.command is CommandName.VALIDATE_MELD:
                result = method(player_id, meld(payload["meld"]))
            elif request.command in (CommandName.SHOW_INITIAL_MELDS, CommandName.VALIDATE_INITIAL_MELDS):
                result = method(player_id, tuple(meld(value) for value in payload["melds"]))
            elif request.command in (CommandName.SHOW_DUBLEES, CommandName.VALIDATE_DUBLEES):
                result = method(player_id, tuple(meld(value) for value in payload["pairs"]))
            elif request.command is CommandName.GET_EVENTS:
                result = method(player_id, payload.get("after_sequence", 0))
            else:
                result = method(player_id)
        except CardConservationError:
            raise  # Invariant failure is infrastructure, not a normal player rejection.
        except MarriageError as error:
            return reject(error.code, str(error))

        messages = []

        def emit(name, payload, recipient=None):
            message = OutboundEvent(match_id=self.match_id, revision=engine.get_state().revision,
                                    index=len(messages), event=name, payload=json_value(payload))
            messages.append(RoutedEvent(message=message, recipient_player_id=recipient))

        if spec.mutates:
            for event in engine.get_public_events(before_sequence):
                emit(event.kind, {"event": event})
            for seat in engine.get_state().config.player_ids:
                emit("PLAYER_STATE", {"player_id": seat, "view": engine.get_player_view(seat)}, seat)
        else:
            emit("QUERY_RESULT", {"player_id": player_id, "command_id": request.command_id,
                                  "command": request.command.value, "result": json_value(result)}, player_id)
        # Complete projection/schema validation before installing a successful candidate.
        self._engine = engine
        return AdapterResult(self.revision, tuple(messages))
