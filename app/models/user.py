from dataclasses import dataclass


@dataclass(frozen=True)
class UserIdentity:
    user_id: str
