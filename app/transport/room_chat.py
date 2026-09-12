"""HTTP translation for shared room chat; no game-specific policies."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.models.chat import ChatInput
from app.models.user import UserIdentity
from app.multiplayer.room_chat import ChatAccessDenied, ChatRateLimited
from app.transport.http import current_user

router = APIRouter(tags=["Room chat"])


@router.get("/rooms/{room_id}/chat")
async def history(room_id: str, request: Request, response: Response,
                  user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await request.app.state.room_chat.history(room_id, user.user_id)
    except ChatAccessDenied as error:
        raise HTTPException(403, str(error)) from error


@router.post("/rooms/{room_id}/chat")
async def send(room_id: str, body: ChatInput, request: Request, response: Response,
               user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await request.app.state.room_chat.send(room_id, user.user_id, body.text)
    except ChatAccessDenied as error:
        raise HTTPException(403, str(error)) from error
    except ChatRateLimited as error:
        raise HTTPException(429, str(error)) from error
