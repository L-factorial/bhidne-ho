from pydantic import BaseModel


class PlayerSummary(BaseModel):
    user_id: str
    display_name: str
    username: str | None = None
    avatar_url: str | None = None


class FriendshipSnapshot(BaseModel):
    online_friend_ids: list[str] | None = None
    friends: list[PlayerSummary]
    incoming: list[PlayerSummary]
    outgoing: list[PlayerSummary]


class DirectMessage(BaseModel):
    sender_avatar_url: str | None = None
    id: str
    sender_id: str
    recipient_id: str
    text: str
    sent_at: int


class FriendNotification(BaseModel):
    payload: dict | None = None
    id: str
    kind: str
    actor: PlayerSummary
    created_at: int
    read: bool
