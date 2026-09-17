from pydantic import BaseModel


class PlayerSummary(BaseModel):
    user_id: str
    display_name: str
    username: str | None = None


class FriendshipSnapshot(BaseModel):
    friends: list[PlayerSummary]
    incoming: list[PlayerSummary]
    outgoing: list[PlayerSummary]


class DirectMessage(BaseModel):
    id: str
    sender_id: str
    recipient_id: str
    text: str
    sent_at: int
