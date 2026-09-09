import json
import re

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.auth.service import AuthenticationError, AuthService
from app.models.messages import ClientMessage
from app.models.game import CommandError, GameCommand

router = APIRouter()


@router.websocket("/ws/rooms/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str) -> None:
    auth: AuthService = websocket.app.state.auth
    token = websocket.query_params.get("token", "")
    try:
        identity = await auth.authenticate(token)
    except AuthenticationError:
        await websocket.close(code=1008)
        return
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", room_id) is None:
        await websocket.close(code=1008)
        return

    connections = websocket.app.state.connections
    runtime = websocket.app.state.runtime
    websocket.app.state.provision_room(room_id)
    await websocket.accept()
    connection_id = await connections.connect(room_id, identity.user_id, websocket)
    try:
        await connections.send_to_connection(room_id, connection_id, {
            "type": "CONNECTED", "user_id": identity.user_id, "room_id": room_id,
        })
        while True:
            frame = await websocket.receive()
            if frame["type"] == "websocket.disconnect":
                break
            try:
                data = json.loads(frame.get("text") or "")
            except (ValueError, TypeError):
                error = CommandError(category="transport", code="INVALID_MESSAGE",
                                     detail="Expected a JSON text message.")
            else:
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
                    error = await runtime.handle(room_id, identity.user_id, message)
            if error is not None:
                await connections.send_to_connection(
                    room_id, connection_id, error.model_dump(mode="json"),
                )
    except WebSocketDisconnect:
        pass
    finally:
        await connections.disconnect(room_id, connection_id)
