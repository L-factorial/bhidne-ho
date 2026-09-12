from fastapi import APIRouter, Depends, Request, Response

from app.models.poke import CallBreakPokeInput, PlayerPhraseInput
from app.models.user import UserIdentity
from app.transport.http import current_user

router = APIRouter(tags=["Room pokes and punchlines"])


@router.get("/me/phrases")
async def phrases(request: Request, response: Response, user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.player_phrases.phrases(user.user_id)


@router.post("/me/phrases", status_code=201)
async def add_phrase(body: PlayerPhraseInput, request: Request, response: Response,
                     user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.player_phrases.add_phrase(user.user_id, body.text)


@router.delete("/me/phrases/{phrase_id}")
async def remove_phrase(phrase_id: str, request: Request, response: Response,
                        user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    await request.app.state.player_phrases.remove_phrase(user.user_id, phrase_id)
    return {"removed": True}


@router.post("/test-games/{room_id}/poke")
async def poke(room_id: str, body: CallBreakPokeInput, request: Request, response: Response,
               user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.test_games.poke(room_id, user.user_id, body, request.app.state.room_pokes)


@router.patch("/me/phrases/{phrase_id}")
async def update_phrase(phrase_id: str, body: PlayerPhraseInput, request: Request, response: Response,
                        user: UserIdentity = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return await request.app.state.player_phrases.update_phrase(user.user_id, phrase_id, body.text)
