from inspect import isawaitable

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.models import AccountCredentials, AccountInput, GuestCredentials, GuestInput, SignUpInput
from app.auth.service import AuthenticationError, UsernameTakenError
from app.models.room import CreateRoom, RoomSummary, UpdateRoom, InviteRoom
from app.models.user import UserIdentity
from app.players.service import PlayerNotFound
from app.players.models import PlayerSummary

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/guest", response_model=GuestCredentials, status_code=201)
async def guest(request: Request, response: Response, body: GuestInput | None = None) -> GuestCredentials:
    response.headers["Cache-Control"] = "no-store"
    if not request.app.state.guest_login_enabled:
        raise HTTPException(403, "Guest login is temporarily disabled. Sign in or create an account.")
    credentials = await request.app.state.guests.issue_guest()
    await request.app.state.players.ensure_user(credentials.user_id)
    if body is not None and body.display_name:
        saved = request.app.state.player_profiles.update(credentials.user_id, body.display_name)
        if isawaitable(saved):
            await saved
    await request.app.state.players.refresh_player(credentials.user_id)
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
async def sign_up(body: SignUpInput, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        credentials = await request.app.state.auth.sign_up(body.username, body.password)
        await request.app.state.players.ensure_user(credentials.user_id)
        if hasattr(request.app.state.players.store, "usernames"):
            request.app.state.players.store.usernames[credentials.user_id] = credentials.username
        request.app.state.player_profiles.remember_username(credentials.user_id, credentials.username)
        if body.display_name:
            saved = request.app.state.player_profiles.update(credentials.user_id, body.display_name)
            if isawaitable(saved):
                await saved
        await request.app.state.players.refresh_player(credentials.user_id)
        return credentials
    except UsernameTakenError as error:
        raise HTTPException(409, str(error)) from None


@router.post("/auth/signin", response_model=AccountCredentials)
async def sign_in(body: AccountInput, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        credentials = await request.app.state.auth.sign_in(body.username, body.password)
        request.app.state.player_profiles.remember_username(credentials.user_id, credentials.username)
        await request.app.state.players.ensure_user(credentials.user_id)
        await request.app.state.players.refresh_player(credentials.user_id)
        return credentials
    except AuthenticationError as error:
        raise HTTPException(401, str(error)) from None


@router.get("/auth/me")
async def me(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.players.store.get_player(user.user_id)


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
    preview_ids = {}
    for room in rooms:
        room.connected_members = await request.app.state.connections.connected_members(room.room_id)
        room.table_count = len(request.app.state.test_games.table_summaries(room.room_id))
        connected = set(room.connected_members)
        preview_ids[room.room_id] = sorted(room.members, key=lambda member: (member not in connected, member))[:4]
    # One lookup for all visible cards, rather than a profile request per avatar.
    profiles = {player["user_id"]: player for player in await request.app.state.players.store.get_players(
        list(dict.fromkeys(member for members in preview_ids.values() for member in members)))}
    for room in rooms:
        room.member_previews = [PlayerSummary(**profiles[member]) for member in preview_ids[room.room_id] if member in profiles]
    return rooms


@router.get("/active-tables")
async def active_tables(request: Request, user: UserIdentity = Depends(current_user)):
    # Use exactly the same room visibility boundary as the lobby feed.
    rooms = await request.app.state.rooms.list_rooms(user.user_id, request.app.state.players.are_friends)
    return [{**table, "room_id": room.room_id, "room_name": room.name}
            for room in rooms
            for table in request.app.state.test_games.table_previews(room.room_id, user.user_id)]


@router.post("/rooms", response_model=RoomSummary, status_code=201)
async def create_room(body: CreateRoom, request: Request, user: UserIdentity = Depends(current_user)):
    invitees = list(dict.fromkeys(body.invitees))
    for target_id in invitees:
        if target_id == user.user_id: raise HTTPException(409, "You cannot invite yourself.")
        try: await request.app.state.players.player(user.user_id, target_id)
        except PlayerNotFound as error: raise HTTPException(404, "Invited player not found.") from error
    room = await request.app.state.rooms.create(body.name, user.user_id, body.visibility)
    await request.app.state.rooms.invite(room.room_id, user.user_id, invitees)
    request.app.state.provision_room(room.room_id)
    return room


@router.get("/room-invitations")
async def room_invitations(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    items = await request.app.state.rooms.invitations_for(user.user_id)
    for item in items:
        item["inviter"] = await request.app.state.players.public_player(item["inviter_id"])
    return items


@router.post("/room-invitations/{invitation_id}/{answer}")
async def answer_room_invitation(invitation_id: str, answer: str, request: Request,
                                 user: UserIdentity = Depends(current_user)):
    if answer not in ("accept", "decline"): raise HTTPException(404, "Unknown invitation action.")
    try: return await request.app.state.rooms.answer_invitation(user.user_id, invitation_id, answer == "accept")
    except ValueError as error: raise HTTPException(404, str(error)) from None


@router.get("/memberships")
async def memberships(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.lifecycle.lookup(user.user_id)


@router.get("/rooms/{room_id}")
async def room_state(room_id: str, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    if not await request.app.state.rooms.can_enter(room_id, user.user_id, request.app.state.players.are_friends):
        raise HTTPException(403, "This room is private. Ask the owner for an invitation.")
    state = await request.app.state.lifecycle.snapshot(room_id, user.user_id)
    record = await request.app.state.rooms.room(room_id)
    if record:
        state.update({key: record[key] for key in ('name', 'creator_id', 'visibility', 'created_at')})
    else:
        # Ad-hoc room IDs remain supported by the low-level room API.
        state.update({"name": room_id, "creator_id": None, "visibility": "public", "created_at": None})
    return state


@router.get("/rooms/{room_id}/members", response_model=list[PlayerSummary])
async def room_members(room_id: str, request: Request, response: Response,
                       user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    members = await request.app.state.rooms.members(room_id)
    if user.user_id not in members:
        raise HTTPException(403, "Join this room to view its members.")
    return await request.app.state.players.store.get_players(members)


@router.post("/rooms/{room_id}/enter")
async def enter_room(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    import re
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", room_id) is None:
        raise HTTPException(422, "Invalid room ID.")
    if not await request.app.state.rooms.can_enter(room_id, user.user_id, request.app.state.players.are_friends):
        raise HTTPException(403, "This room is private. Ask the owner for an invitation.")
    request.app.state.provision_room(room_id)
    return await request.app.state.lifecycle.enter(room_id, user.user_id)


@router.post("/rooms/{room_id}/leave")
async def leave_room(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    room = await request.app.state.rooms.room(room_id)
    if room and room["creator_id"] == user.user_id:
        raise HTTPException(409, "Room owners cannot leave their room. Delete it after ending every active table.")
    return await request.app.state.lifecycle.leave(room_id, user.user_id)


@router.delete("/rooms/{room_id}", status_code=204)
async def delete_room(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    room = await request.app.state.rooms.room(room_id)
    if room is None:
        raise HTTPException(404, "Room not found.")
    if room["creator_id"] != user.user_id:
        raise HTTPException(403, "Only the room owner can delete this room.")
    if request.app.state.test_games.has_active_tables(room_id):
        raise HTTPException(409, "End every active table before deleting this room.")
    await request.app.state.lifecycle.delete(room_id)


@router.patch("/rooms/{room_id}")
async def update_room(room_id: str, body: UpdateRoom, request: Request, user: UserIdentity = Depends(current_user)):
    return await request.app.state.rooms.update_visibility(room_id, user.user_id, body.visibility)


@router.post("/rooms/{room_id}/invitations")
async def invite_room(room_id: str, body: InviteRoom, request: Request, user: UserIdentity = Depends(current_user)):
    for target in body.invitees:
        if target == user.user_id:
            raise HTTPException(409, "You cannot invite yourself.")
        try:
            await request.app.state.players.player(user.user_id, target)
        except PlayerNotFound:
            raise HTTPException(404, "Invited player not found.") from None
    try:
        return await request.app.state.rooms.invite(room_id, user.user_id, body.invitees)
    except ValueError as error:
        raise HTTPException(403, str(error)) from None
