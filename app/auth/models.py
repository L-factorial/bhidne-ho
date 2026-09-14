from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class GuestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Empty legacy requests remain supported for scripts; supplied names cannot be blank.
    display_name: str = Field(default="", min_length=1, max_length=25)

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value):
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Use a name without control characters.")
        value = " ".join(value.split())
        if not value:
            raise ValueError("Enter your display name.")
        return value
