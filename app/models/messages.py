from typing import Literal

from pydantic import BaseModel, ConfigDict, JsonValue


class ClientMessage(BaseModel):
    # Ignore untrusted envelope fields, including sender_id and room_id.
    model_config = ConfigDict(extra="ignore")
    type: Literal["MESSAGE"]
    payload: dict[str, JsonValue]


class ServerMessage(BaseModel):
    type: Literal["MESSAGE"] = "MESSAGE"
    sender_id: str
    payload: dict[str, JsonValue]
