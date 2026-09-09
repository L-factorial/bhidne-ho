from pydantic import BaseModel, Field, field_validator


class GuestCredentials(BaseModel):
    user_id: str
    token: str


class AccountCredentials(GuestCredentials):
    username: str


class AccountInput(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().lower() if isinstance(value, str) else value
