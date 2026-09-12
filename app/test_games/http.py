"""Test-only HTTP commands; never enabled through the generic Echo runtime."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.adapters.callbreak.contracts import COMMAND_SPECS, CommandName
from app.adapters.marriage.contracts import COMMAND_SPECS as MARRIAGE_COMMANDS, CommandName as MarriageCommandName
from app.models.user import UserIdentity
from app.models.action import ActionCommand
from app.transport.http import current_user

router = APIRouter(prefix="/test-games", tags=["Test console only"])


class CreateGame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_count: Annotated[int, Field(strict=True, ge=2, le=5)]
    game_type: Literal["callbreak", "marriage"] = "callbreak"

    @model_validator(mode="after")
    def capacity(self):
        if self.game_type == "callbreak" and self.player_count < 4:
            raise ValueError("Call Break requires four or five players.")
        return self


class JoinGame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    match_id: Annotated[str, Field(min_length=1, max_length=128)]


class StartGame(JoinGame):
    play_mode: Literal["manual", "auto"] = "auto"


class GameAction(ActionCommand):
    command: CommandName | MarriageCommandName

    @model_validator(mode="after")
    def validate_payload(self):
        specs = MARRIAGE_COMMANDS if isinstance(self.command, MarriageCommandName) else COMMAND_SPECS
        specs[self.command].payload.model_validate(self.payload)
        return self


@router.get("/{room_id}")
async def state(room_id: str, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.snapshot(room_id, user.user_id)


@router.post("/{room_id}", status_code=201)
async def create(room_id: str, body: CreateGame, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.create(room_id, user.user_id, body.player_count, body.game_type)


@router.post("/{room_id}/join")
async def join(room_id: str, body: JoinGame, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.join(room_id, user.user_id, body.match_id)


@router.post("/{room_id}/action")
async def action(room_id: str, body: GameAction, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.action(room_id, user.user_id, body)


@router.post("/{room_id}/leave")
async def leave(room_id: str, body: JoinGame, request: Request, response: Response,
                user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.leave(room_id, user.user_id, body.match_id)


class GameSettings(JoinGame):
    weak_hand_enabled: Annotated[bool, Field(strict=True)] = True
    no_spades_enabled: Annotated[bool, Field(strict=True)] = True
    payments: Annotated[list[Annotated[int, Field(strict=True, ge=0, le=1000000)]], Field(min_length=4, max_length=4)] = [0, 0, 0, 0]


class MarriageSettings(JoinGame):
    scoring: dict


@router.post("/{room_id}/marriage-settings")
async def marriage_settings(room_id: str, body: MarriageSettings, request: Request,
                            user: UserIdentity = Depends(current_user)):
    return await request.app.state.test_games.configure_marriage(room_id, user.user_id, body)


@router.post("/{room_id}/settings")
async def settings(room_id: str, body: GameSettings, request: Request, user: UserIdentity = Depends(current_user)):
    return await request.app.state.test_games.configure(room_id, user.user_id, body)


@router.post("/{room_id}/start")
async def start(room_id: str, body: StartGame, request: Request, user: UserIdentity = Depends(current_user)):
    return await request.app.state.test_games.start(room_id, user.user_id, body.match_id, body.play_mode)


@router.post("/{room_id}/end")
async def end(room_id: str, body: JoinGame, request: Request, response: Response,
              user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.end(room_id, user.user_id, body.match_id)


class NextDeal(JoinGame):
    deal_number: Annotated[int, Field(strict=True, ge=1, le=4)]


@router.post("/{room_id}/next-deal")
async def next_deal(room_id: str, body: NextDeal, request: Request, response: Response,
                    user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.next_deal(room_id, user.user_id, body.match_id, body.deal_number)
