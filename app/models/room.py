from typing import Literal

from app.players.models import PlayerSummary

from pydantic import BaseModel, ConfigDict, Field


class RoomPresence(BaseModel):
    room_id: str
    members: list[str]
    connected_members: list[str] = Field(default_factory=list)


class RoomSummary(RoomPresence):
    creator_is_friend: bool = False
    table_count: int = 0
    member_previews: list[PlayerSummary] = Field(default_factory=list)
    name: str
    creator_id: str | None = None
    visibility: Literal["public", "private", "friends"] = "private"
    created_at: int | None = None
    feed_source: Literal["you", "joined", "friend", "public"] = "public"


class CreateRoom(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    visibility: Literal["public", "private", "friends"] = "private"
    invitees: list[str] = Field(default_factory=list, max_length=20)
    model_config = ConfigDict(str_strip_whitespace=True)


class UpdateRoom(BaseModel):
    visibility: Literal["public", "private"]


class InviteRoom(BaseModel):
    invitees: list[str] = Field(min_length=1, max_length=20)
