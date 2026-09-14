from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.models import AccountCredentials, AccountInput, GuestCredentials, GuestInput
from app.auth.service import AuthenticationError, UsernameTakenError
from app.models.room import CreateRoom, RoomSummary
from app.models.user import UserIdentity

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/guest", response_model=GuestCredentials, status_code=201)
async def guest(request: Request, response: Response, body: GuestInput | None = None) -> GuestCredentials:
    response.headers["Cache-Control"] = "no-store"
    credentials = await request.app.state.guests.issue_guest()
    if body is not None and body.display_name:
        request.app.state.player_profiles.update(credentials.user_id, body.display_name)
    return credentials

bearer = HTTPBearer(auto_error=False)


async def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> UserIdentity:
    try:
        return await request.app.state.auth.authenticate(credentials.credentials if credentials else "")
    except AuthenticationError:
        raise HTTPException(401, "Sign in to continue", headers={"WWW-Authenticate": "Bearer"}) from None


@router.post("/auth/signup", response_model=AccountCredentials, status_code=201)
async def sign_up(body: AccountInput, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await request.app.state.auth.sign_up(body.username, body.password)
    except UsernameTakenError as error:
        raise HTTPException(409, str(error)) from None


@router.post("/auth/signin", response_model=AccountCredentials)
async def sign_in(body: AccountInput, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await request.app.state.auth.sign_in(body.username, body.password)
    except AuthenticationError as error:
        raise HTTPException(401, str(error)) from None


@router.get("/auth/me")
async def me(user: UserIdentity = Depends(current_user)):
    return {"user_id": user.user_id}


@router.get("/rooms", response_model=list[RoomSummary])
async def list_rooms(request: Request, user: UserIdentity = Depends(current_user)):
    rooms = await request.app.state.rooms.list_rooms()
    for room in rooms:
        room.connected_members = await request.app.state.connections.connected_members(room.room_id)
    return rooms


@router.post("/rooms", response_model=RoomSummary, status_code=201)
async def create_room(body: CreateRoom, request: Request, user: UserIdentity = Depends(current_user)):
    room = await request.app.state.rooms.create(body.name)
    request.app.state.provision_room(room.room_id)
    return room


@router.get("/memberships")
async def memberships(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.lifecycle.lookup(user.user_id)


@router.get("/rooms/{room_id}")
async def room_state(room_id: str, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.lifecycle.snapshot(room_id, user.user_id)


@router.post("/rooms/{room_id}/enter")
async def enter_room(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    import re
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", room_id) is None:
        raise HTTPException(422, "Invalid room ID.")
    request.app.state.provision_room(room_id)
    return await request.app.state.lifecycle.enter(room_id, user.user_id)


@router.post("/rooms/{room_id}/leave")
async def leave_room(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    return await request.app.state.lifecycle.leave(room_id, user.user_id)
