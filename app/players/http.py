from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.models.chat import ChatInput
from app.models.user import UserIdentity
from app.players.models import DirectMessage, FriendNotification, FriendshipSnapshot, PlayerSummary
from app.players.service import (
    DirectMessageRateLimited, FriendshipConflict, FriendshipDenied, PlayerNotFound,
)
from app.transport.http import current_user

router = APIRouter(tags=["Players and friends"])


def translate(error):
    if isinstance(error, PlayerNotFound): return HTTPException(404, str(error))
    if isinstance(error, FriendshipDenied): return HTTPException(403, str(error))
    if isinstance(error, DirectMessageRateLimited): return HTTPException(429, str(error))
    return HTTPException(409, str(error))


@router.get("/players/search", response_model=list[PlayerSummary])
async def search_players(request: Request, q: str = Query(min_length=2, max_length=50),
                         user: UserIdentity = Depends(current_user)):
    return await request.app.state.players.search(user.user_id, q.strip())


@router.get("/players/directory", response_model=list[PlayerSummary])
async def search_directory(request: Request, response: Response,
                           q: str = Query(min_length=2, max_length=64),
                           user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.players.directory_search(user.user_id, q.strip())


@router.get("/players/{player_id}", response_model=PlayerSummary)
async def player(player_id: str, request: Request, response: Response,
                 user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    if not player_id.startswith("user-") or len(player_id) > 64:
        raise HTTPException(404, "Player not found.")
    try: return await request.app.state.players.player(user.user_id, player_id)
    except PlayerNotFound as error: raise translate(error) from None


@router.get("/friends", response_model=FriendshipSnapshot)
async def friends(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.players.snapshot(user.user_id)


@router.post("/friends/requests/{target_id}", response_model=PlayerSummary, status_code=201)
async def request_friend(target_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    try: return await request.app.state.players.request_friend(user.user_id, target_id)
    except (PlayerNotFound, FriendshipConflict) as error: raise translate(error) from None


@router.post("/friends/requests/{requester_id}/accept", response_model=PlayerSummary)
async def accept_friend(requester_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    try: return await request.app.state.players.accept(user.user_id, requester_id)
    except (PlayerNotFound, FriendshipConflict) as error: raise translate(error) from None


@router.delete("/friends/{other_id}", status_code=204)
async def remove_friend(other_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    try: await request.app.state.players.remove(user.user_id, other_id)
    except (PlayerNotFound, FriendshipConflict) as error: raise translate(error) from None


@router.get("/notifications", response_model=list[FriendNotification])
async def notifications(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.players.notifications(user.user_id)


@router.post("/notifications/read", status_code=204)
async def read_notifications(request: Request, user: UserIdentity = Depends(current_user)):
    await request.app.state.players.read_notifications(user.user_id)


@router.get("/friends/{friend_id}/messages", response_model=list[DirectMessage])
async def message_history(friend_id: str, request: Request, response: Response,
                          user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    try: return await request.app.state.players.history(user.user_id, friend_id)
    except (PlayerNotFound, FriendshipDenied) as error: raise translate(error) from None


@router.post("/friends/{friend_id}/messages", response_model=DirectMessage, status_code=201)
async def send_message(friend_id: str, body: ChatInput, request: Request,
                       user: UserIdentity = Depends(current_user)):
    try: return await request.app.state.players.send(user.user_id, friend_id, body.text)
    except (PlayerNotFound, FriendshipDenied, DirectMessageRateLimited) as error: raise translate(error) from None
