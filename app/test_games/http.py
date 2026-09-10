"""Test-only HTTP commands; never enabled through the generic Echo runtime."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from app.adapters.callbreak.contracts import COMMAND_SPECS, CommandName
from app.models.user import UserIdentity
from app.transport.http import current_user

router = APIRouter(prefix="/test-games", tags=["Test console only"])


class CreateGame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_count: Annotated[int, Field(strict=True, ge=4, le=5)]


class JoinGame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    match_id: Annotated[str, Field(min_length=1, max_length=128)]


class GameAction(JoinGame):
    expected_revision: Annotated[int, Field(strict=True, ge=0)]
    command: CommandName
    payload: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_payload(self):
        COMMAND_SPECS[self.command].payload.model_validate(self.payload)
        return self


@router.get("/{room_id}")
async def state(room_id: str, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.snapshot(room_id, user.user_id)


@router.post("/{room_id}", status_code=201)
async def create(room_id: str, body: CreateGame, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.create(room_id, user.user_id, body.player_count)


@router.post("/{room_id}/join")
async def join(room_id: str, body: JoinGame, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.join(room_id, user.user_id, body.match_id)


@router.post("/{room_id}/action")
async def action(room_id: str, body: GameAction, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.action(room_id, user.user_id, body)
