from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.models import AccountCredentials, AccountInput, GuestCredentials
from app.auth.service import AuthenticationError, UsernameTakenError
from app.models.room import CreateRoom, RoomSummary
from app.models.user import UserIdentity

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/guest", response_model=GuestCredentials, status_code=201)
async def guest(request: Request, response: Response) -> GuestCredentials:
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.guests.issue_guest()

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
    return await request.app.state.rooms.list_rooms()


@router.post("/rooms", response_model=RoomSummary, status_code=201)
async def create_room(body: CreateRoom, request: Request, user: UserIdentity = Depends(current_user)):
    room = await request.app.state.rooms.create(body.name)
    request.app.state.provision_room(room.room_id)
    return room
