import asyncio
import json
import re

from inspect import isawaitable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.auth.service import AuthenticationError, AuthService
from app.models.messages import ClientMessage
from app.multiplayer.connection_manager import RoomMembershipEnded
from app.models.game import CommandError, GameCommand
from app.models.table_social import TableSocialCommand

router = APIRouter()
HEARTBEAT_TIMEOUT_SECONDS = 30


@router.websocket("/ws/rooms/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str) -> None:
    auth: AuthService = websocket.app.state.auth
    token = websocket.query_params.get("token", "")
    try:
        identity = await auth.authenticate(token)
        profile = websocket.app.state.player_profiles.get(identity.user_id)
        if isawaitable(profile):
            await profile
    except AuthenticationError:
        await websocket.close(code=1008)
        return
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", room_id) is None:
        await websocket.close(code=1008)
        return
    if not await websocket.app.state.rooms.can_enter(
        room_id, identity.user_id, websocket.app.state.players.are_friends,
    ):
        await websocket.close(code=1008, reason="This room is for the creator's friends")
        return

    connections = websocket.app.state.connections
    runtime = websocket.app.state.runtime
    websocket.app.state.provision_room(room_id)
    await websocket.accept()
    try:
        connection_id = await connections.connect(room_id, identity.user_id, websocket,
            resume=websocket.query_params.get("resume") == "1")
    except RoomMembershipEnded:
        await websocket.send_json({"type": "ROOM_LEFT", "room_id": room_id})
        await websocket.close(code=1000)
        return
    # Opt-in keeps existing console/terminal clients compatible.
    receive_timeout = HEARTBEAT_TIMEOUT_SECONDS if websocket.query_params.get("heartbeat") == "1" else None
    try:
        await connections.send_to_connection(room_id, connection_id, {
            "type": "CONNECTED", "user_id": identity.user_id, "room_id": room_id,
            "membership": await websocket.app.state.lifecycle.snapshot(room_id, identity.user_id),
        })
        while True:
            frame = await asyncio.wait_for(websocket.receive(), timeout=receive_timeout)
            if frame["type"] == "websocket.disconnect":
                break
            try:
                data = json.loads(frame.get("text") or "")
            except (ValueError, TypeError):
                error = CommandError(category="transport", code="INVALID_MESSAGE",
                                     detail="Expected a JSON text message.")
            else:
                if isinstance(data, dict) and data.get("type") == "HEARTBEAT":
                    await connections.send_to_connection(
                        room_id, connection_id, {"type": "HEARTBEAT_ACK"},
                    )
                    continue
                if isinstance(data, dict) and data.get("type") in {"TABLE_CHAT_SEND", "TABLE_CHAT_HISTORY", "TABLE_POKE_SEND"}:
                    try:
                        social_command = TableSocialCommand.model_validate(data)
                    except ValidationError:
                        response = {"type": "TABLE_SOCIAL_ACK", "room_id": room_id,
                            "match_id": data.get("match_id"), "command_id": data.get("command_id"),
                            "status": "rejected", "detail": "Invalid social command."}
                    else:
                        response = await websocket.app.state.table_social.handle(room_id, identity.user_id, social_command)
                    await connections.send_to_connection(room_id, connection_id, response)
                    continue
                is_command = isinstance(data, dict) and data.get("type") == "GAME_COMMAND"
                try:
                    message = (GameCommand if is_command else ClientMessage).model_validate(data)
                except ValidationError:
                    error = CommandError(
                        category="transport",
                        code="INVALID_COMMAND" if is_command else "INVALID_MESSAGE",
                        detail="Expected GAME_COMMAND with a command and object payload, or MESSAGE with an object payload.",
                    )
                else:
                    if identity.user_id not in await websocket.app.state.rooms.members(room_id):
                        error = CommandError(category="transport", code="ROOM_LEFT", detail="Enter the room before sending messages.")
                    else:
                        error = await runtime.handle(room_id, identity.user_id, message)
            if error is not None:
                await connections.send_to_connection(
                    room_id, connection_id, error.model_dump(mode="json"),
                )
    except WebSocketDisconnect:
        pass
    except TimeoutError:
        await websocket.close(code=1001, reason="Heartbeat timed out")
    finally:
        await connections.disconnect(room_id, connection_id)
