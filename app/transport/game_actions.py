"""Shared reliable HTTP actions for engines registered with a command adapter."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.models.action import ReliableActionCommand
from app.models.user import UserIdentity
from app.runtime.command_runtime import CommandAccessError
from app.transport.http import current_user

router = APIRouter(prefix="/games", tags=["Shared game commands"])


async def member(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    if user.user_id not in await request.app.state.rooms.members(room_id):
        raise HTTPException(403, "Connect to this room before using its game.")
    return user


@router.get("/{room_id}")
async def snapshot(room_id: str, request: Request, response: Response, user: UserIdentity = Depends(member)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await request.app.state.runtime.snapshot(room_id, user.user_id)
    except CommandAccessError as error:
        raise HTTPException(error.status, error.detail) from error


@router.post("/{room_id}/action")
async def action(room_id: str, body: ReliableActionCommand, request: Request, response: Response,
                 user: UserIdentity = Depends(member)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await request.app.state.runtime.action(room_id, user.user_id, body)
    except CommandAccessError as error:
        raise HTTPException(error.status, error.detail) from error
