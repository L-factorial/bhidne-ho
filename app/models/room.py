from pydantic import BaseModel, ConfigDict, Field


class RoomPresence(BaseModel):
    room_id: str
    members: list[str]


class RoomSummary(RoomPresence):
    name: str


class CreateRoom(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    model_config = ConfigDict(str_strip_whitespace=True)
