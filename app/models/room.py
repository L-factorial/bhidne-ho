from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RoomPresence(BaseModel):
    room_id: str
    members: list[str]
    connected_members: list[str] = Field(default_factory=list)


class RoomSummary(RoomPresence):
    name: str
    creator_id: str | None = None
    visibility: Literal["public", "friends"] = "public"
    created_at: int | None = None
    feed_source: Literal["you", "joined", "friend", "public"] = "public"


class CreateRoom(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    visibility: Literal["public", "friends"] = "public"
    invitees: list[str] = Field(default_factory=list, max_length=20)
    model_config = ConfigDict(str_strip_whitespace=True)
