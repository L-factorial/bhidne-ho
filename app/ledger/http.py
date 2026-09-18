from fastapi import APIRouter, Depends, HTTPException, Request

from app.models.user import UserIdentity
from app.transport.http import current_user
from .models import CreateSettlement, SettlementAction

router = APIRouter(prefix="/rooms/{room_id}/ledger", tags=["Ledger"])


def mapped(error):
    if isinstance(error, PermissionError): return HTTPException(403, str(error))
    if isinstance(error, KeyError): return HTTPException(404, str(error.args[0]))
    return HTTPException(409, str(error))


@router.get("")
async def ledger(room_id: str, request: Request, user: UserIdentity = Depends(current_user)):
    try: return await request.app.state.ledger.snapshot(room_id, user.user_id)
    except (PermissionError, KeyError, ValueError) as error: raise mapped(error) from None


@router.post("/settlements", status_code=201)
async def create_settlement(room_id: str, body: CreateSettlement, request: Request,
                            user: UserIdentity = Depends(current_user)):
    try: return await request.app.state.ledger.create_settlement(room_id, user.user_id, body)
    except (PermissionError, KeyError, ValueError) as error: raise mapped(error) from None


@router.post("/settlements/{batch_id}/transfers/{transfer_id}/{action}")
async def settlement_action(room_id: str, batch_id: str, transfer_id: str, action: str,
                            body: SettlementAction, request: Request,
                            user: UserIdentity = Depends(current_user)):
    try: return await request.app.state.ledger.act(room_id, batch_id, transfer_id, user.user_id,
                                                   action, body.idempotency_key)
    except (PermissionError, KeyError, ValueError) as error: raise mapped(error) from None
