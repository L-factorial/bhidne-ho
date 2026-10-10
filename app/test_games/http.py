"""Test-only HTTP commands; never enabled through the generic Echo runtime."""

from typing import Annotated, Literal
from callbreak.match_rules import MatchRules

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator

from app.adapters.callbreak.contracts import COMMAND_SPECS, CommandName
from app.adapters.marriage.contracts import COMMAND_SPECS as MARRIAGE_COMMANDS, CommandName as MarriageCommandName
from app.adapters.flush.contracts import COMMAND_SPECS as FLUSH_COMMANDS, CommandName as FlushCommandName
from app.multiplayer.card_themes import CardThemeId
from app.models.user import UserIdentity
from app.models.action import ActionCommand
from app.transport.http import current_user

router = APIRouter(prefix="/test-games", tags=["Test console only"])


class CreateGame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_count: Annotated[int, Field(strict=True, ge=2, le=10)] | None = None
    game_type: Literal["callbreak", "marriage", "flush"] = "callbreak"
    name: Annotated[str, Field(min_length=1, max_length=60)] = "Table"
    card_theme: CardThemeId = "kathmandu"
    invitees: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def capacity(self):
        from app.multiplayer.table_creation import table_capacity
        self.player_count = table_capacity(self.game_type, self.player_count)
        return self


class JoinGame(BaseModel):
    model_config = ConfigDict(extra="forbid")
    match_id: Annotated[str, Field(min_length=1, max_length=128)]


class CardThemeChange(JoinGame):
    card_theme: CardThemeId


@router.post("/{room_id}/card-theme")
async def card_theme(room_id: str, body: CardThemeChange, request: Request,
                     user: UserIdentity = Depends(current_user)):
    return await request.app.state.test_games.change_card_theme(room_id, user.user_id, body)


class InvitationCandidates(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_ids: list[str] = Field(min_length=1, max_length=20)


class StartGame(JoinGame):
    play_mode: Literal["manual"] = "manual"
    rules_revision: Annotated[int, Field(strict=True, ge=0)] | None = None


class GameAction(ActionCommand):
    command: CommandName | MarriageCommandName | FlushCommandName

    @model_validator(mode="after")
    def validate_payload(self):
        specs = FLUSH_COMMANDS if isinstance(self.command, FlushCommandName) else MARRIAGE_COMMANDS if isinstance(self.command, MarriageCommandName) else COMMAND_SPECS
        specs[self.command].payload.model_validate(self.payload)
        return self


@router.get("/invitations")
async def invitations(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.invitations_for(user.user_id)


@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(invitation_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    return await request.app.state.test_games.answer_invitation(user.user_id, invitation_id, True)


@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(invitation_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    return await request.app.state.test_games.answer_invitation(user.user_id, invitation_id, False)


@router.post("/{room_id}/invitations/eligibility")
async def invitation_eligibility(room_id: str, body: InvitationCandidates, request: Request,
                                 user: UserIdentity = Depends(current_user)):
    return await request.app.state.test_games.invitation_eligibility(room_id, user.user_id, body.player_ids)


@router.get("/{room_id}")
async def state(room_id: str, request: Request, response: Response, match_id: str | None = None,
                user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.snapshot(room_id, user.user_id, match_id)


@router.post("/{room_id}", status_code=201)
async def create(room_id: str, body: CreateGame, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.create(room_id, user.user_id, body.player_count, body.game_type, body.name, body.invitees, body.card_theme)


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
    match_rules: MatchRules | None = None

    @field_validator('match_rules', mode='before')
    @classmethod
    def strict_match_rules(cls, value):
        if value is None or isinstance(value, MatchRules):
            return value
        if not isinstance(value, dict):
            raise ValueError('Match rules must be an object.')
        try:
            return MatchRules(**value)
        except TypeError as error:
            raise ValueError('Unknown match rule.') from error

    weak_hand_enabled: Annotated[bool, Field(strict=True)] = True
    minimum_face_card: Literal['ANY', 'JACK', 'QUEEN'] | None = None
    no_spades_enabled: Annotated[bool, Field(strict=True)] = True
    payments: Annotated[list[Annotated[int, Field(strict=True, ge=0, le=1000000)]], Field(min_length=4, max_length=4)] = [1, 3, 5, 7]

    @model_validator(mode='after')
    def face_requirement(self):
        if self.minimum_face_card is not None:
            self.weak_hand_enabled = self.minimum_face_card != 'ANY'
        return self


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
    return await request.app.state.test_games.start(room_id, user.user_id, body.match_id, body.play_mode, body.rules_revision)


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


class FlushSettings(JoinGame):
    rules_revision: Annotated[int, Field(strict=True, ge=0)]
    rules: dict


@router.post('/{room_id}/flush-settings')
async def flush_settings(room_id: str, body: FlushSettings, request: Request,
                         user: UserIdentity = Depends(current_user)):
    return await request.app.state.test_games.configure_flush(room_id, user.user_id, body)


class TableCommand(JoinGame):
    offer_id: str | None = None
    seat_id: Annotated[int, Field(strict=True, ge=1, le=10)] | None = None
    recipient: str | None = None


@router.post("/{room_id}/table/{command}")
async def table_command(room_id: str, command: Literal["join-queue", "leave-queue", "lock", "leave-seat",
                        "invite-seat", "accept-seat", "decline-seat", "abandon", "next-match"],
                        body: TableCommand, request: Request, response: Response,
                        user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.table_command(room_id, user.user_id, body.match_id, command,
        offer_id=body.offer_id, seat_id=body.seat_id, recipient=body.recipient)


class RuleVote(JoinGame):
    proposal_id: Annotated[str, Field(min_length=1, max_length=128)]
    accept: Annotated[bool, Field(strict=True)]


@router.post("/{room_id}/rule-vote")
async def rule_vote(room_id: str, body: RuleVote, request: Request, response: Response,
                    user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.vote_rules(room_id, user.user_id, body)
