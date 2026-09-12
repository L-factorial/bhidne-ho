from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserIdentity
from app.transport.http import current_user

router = APIRouter(tags=["Player profile"])


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(max_length=25)

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value):
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Use a name without control characters.")
        return " ".join(value.split())


@router.get("/me/profile")
async def profile(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return request.app.state.player_profiles.get(user.user_id)


@router.patch("/me/profile")
async def update_profile(body: ProfileInput, request: Request, response: Response,
                         user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return request.app.state.player_profiles.update(user.user_id, body.display_name)
