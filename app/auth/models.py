from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.auth.email import normalize_recovery_email


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


class SignInInput(BaseModel):
    username: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator('username', mode='before')
    @classmethod
    def normalize_identifier(cls, value):
        if not isinstance(value, str):
            return value
        value = value.strip()
        if '@' in value:
            return normalize_recovery_email(value)
        import re
        if not re.fullmatch(r'[a-zA-Z0-9_-]{3,32}', value):
            raise ValueError('Enter your username or verified email address.')
        return value.lower()


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
        from app.moderation.content import validate_content
        return validate_content(value)


class SignUpInput(AccountInput, GuestInput):
    """Named app registration; legacy clients may omit the profile field."""

    @field_validator('username')
    @classmethod
    def safe_username(cls, value):
        from app.moderation.content import validate_content
        return validate_content(value)

    community_rules_version: str

    @field_validator('community_rules_version')
    @classmethod
    def accepted_current_rules(cls, value):
        from app.moderation.policy import RULES_VERSION
        if value != RULES_VERSION:
            raise ValueError('Accept the current community rules before creating your account.')
        return value

    email: str = Field(min_length=3, max_length=254)

    @field_validator('email')
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_recovery_email(value)
