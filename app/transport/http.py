from inspect import isawaitable

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
    await request.app.state.players.ensure_user(credentials.user_id)
    if body is not None and body.display_name:
        saved = request.app.state.player_profiles.update(credentials.user_id, body.display_name)
        if isawaitable(saved):
            await saved
    return credentials

bearer = HTTPBearer(auto_error=False)


async def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> UserIdentity:
    try:
        identity = await request.app.state.auth.authenticate(credentials.credentials if credentials else "")
        await request.app.state.players.ensure_user(identity.user_id)
        # Refresh the local profile read model used by synchronous game snapshots.
        profile = request.app.state.player_profiles.get(identity.user_id)
        if isawaitable(profile):
            await profile
        return identity
    except AuthenticationError:
        raise HTTPException(401, "Sign in to continue", headers={"WWW-Authenticate": "Bearer"}) from None


@router.post("/auth/signup", response_model=AccountCredentials, status_code=201)
async def sign_up(body: AccountInput, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        credentials = await request.app.state.auth.sign_up(body.username, body.password)
        await request.app.state.players.ensure_user(credentials.user_id)
        if hasattr(request.app.state.players.store, "usernames"):
            request.app.state.players.store.usernames[credentials.user_id] = credentials.username
        return credentials
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


@router.post("/auth/signout", status_code=204)
async def sign_out(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    user: UserIdentity = Depends(current_user),
):
    await request.app.state.auth.revoke(credentials.credentials)


@router.get("/rooms", response_model=list[RoomSummary])
async def list_rooms(request: Request, user: UserIdentity = Depends(current_user)):
    rooms = await request.app.state.rooms.list_rooms(user.user_id, request.app.state.players.are_friends)
    for room in rooms:
        room.connected_members = await request.app.state.connections.connected_members(room.room_id)
    return rooms


@router.post("/rooms", response_model=RoomSummary, status_code=201)
async def create_room(body: CreateRoom, request: Request, user: UserIdentity = Depends(current_user)):
    room = await request.app.state.rooms.create(body.name, user.user_id, body.visibility)
    request.app.state.provision_room(room.room_id)
    return room


@router.get("/memberships")
async def memberships(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.lifecycle.lookup(user.user_id)


@router.get("/rooms/{room_id}")
async def room_state(room_id: str, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    if not await request.app.state.rooms.can_enter(room_id, user.user_id, request.app.state.players.are_friends):
        raise HTTPException(403, "This room is for the creator's friends.")
    state = await request.app.state.lifecycle.snapshot(room_id, user.user_id)
    record = await request.app.state.rooms.room(room_id)
    if record:
        state.update({key: record[key] for key in ('name', 'creator_id', 'visibility', 'created_at')})
    else:
        # Ad-hoc room IDs remain supported by the low-level room API.
        state.update({"name": room_id, "creator_id": None, "visibility": "public", "created_at": None})
    return state


@router.post("/rooms/{room_id}/enter")
async def enter_room(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    import re
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", room_id) is None:
        raise HTTPException(422, "Invalid room ID.")
    if not await request.app.state.rooms.can_enter(room_id, user.user_id, request.app.state.players.are_friends):
        raise HTTPException(403, "This room is for the creator's friends.")
    request.app.state.provision_room(room_id)
    return await request.app.state.lifecycle.enter(room_id, user.user_id)


@router.post("/rooms/{room_id}/leave")
async def leave_room(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    return await request.app.state.lifecycle.leave(room_id, user.user_id)


@router.delete("/rooms/{room_id}", status_code=204)
async def delete_room(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    room = await request.app.state.rooms.room(room_id)
    if room is None:
        raise HTTPException(404, "Room not found.")
    if room["creator_id"] != user.user_id:
        raise HTTPException(403, "Only the room owner can delete this room.")
    await request.app.state.lifecycle.delete(room_id)
