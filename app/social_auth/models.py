from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Provider = Literal["google", "apple", "facebook"]


class ProviderCredential(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: str = Field(min_length=20, max_length=16_384)
    nonce: str | None = Field(default=None, min_length=8, max_length=256)


class VerifiedIdentity(BaseModel):
    provider: Provider
    subject: str = Field(min_length=1, max_length=512)
    email: str | None = Field(default=None, max_length=320)
    email_verified: bool = False
    display_name: str = Field(default="", max_length=25)
