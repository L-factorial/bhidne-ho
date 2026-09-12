from fastapi import APIRouter, Depends, Request, Response

from app.models.poke import CallBreakPokeInput, RoomPhraseInput
from app.models.user import UserIdentity
from app.transport.http import current_user

router = APIRouter(tags=["Room pokes and punchlines"])


@router.get("/rooms/{room_id}/phrases")
async def phrases(room_id: str, request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.room_pokes.phrases(room_id, user.user_id)


@router.post("/rooms/{room_id}/phrases", status_code=201)
async def add_phrase(room_id: str, body: RoomPhraseInput, request: Request, response: Response,
                     user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.room_pokes.add_phrase(room_id, user.user_id, body.text)


@router.delete("/rooms/{room_id}/phrases/{phrase_id}")
async def remove_phrase(room_id: str, phrase_id: str, request: Request, response: Response,
                        user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    await request.app.state.room_pokes.remove_phrase(room_id, user.user_id, phrase_id)
    return {"removed": True}


@router.post("/test-games/{room_id}/poke")
async def poke(room_id: str, body: CallBreakPokeInput, request: Request, response: Response,
               user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.poke(room_id, user.user_id, body, request.app.state.room_pokes)
