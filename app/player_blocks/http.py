"""Session-bound blocking endpoints; legacy runtimes advertise no support."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict
from uuid import UUID
from app.transport.http import current_user
from app.durable_games.queries import QueryAccessDenied

router=APIRouter()
CONTRACTS={('GET','/auth/safety/capabilities'),('GET','/me/blocks'),('POST','/me/blocks/{player_id}'),('DELETE','/me/blocks/{player_id}')}
class Empty(BaseModel):
    model_config=ConfigDict(extra='forbid')

def service(request):
    value=getattr(request.app.state,'blocks',None)
    if value is None:raise HTTPException(503,'Blocking is unavailable in this runtime.')
    return value

@router.get('/auth/safety/capabilities')
async def capabilities(request:Request,response:Response):
    response.headers['Cache-Control']='no-store'
    return {'blocking':getattr(request.app.state,'blocks',None) is not None}

@router.get('/me/blocks')
async def listed(request:Request,response:Response,after:UUID|None=None,limit:int=Query(50,ge=1,le=100),user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    return await service(request).list(user.user_id,str(after) if after else None,limit)

async def change(request,user,player_id,active):
    try:return await service(request).set(user.user_id,player_id,active)
    except (ValueError,AttributeError):raise HTTPException(422,'Invalid player identity.') from None
    except QueryAccessDenied:raise HTTPException(403,'Player is unavailable.') from None

@router.post('/me/blocks/{player_id}')
async def block(player_id:str,body:Empty,request:Request,user=Depends(current_user)):
    return await change(request,user,player_id,True)

@router.delete('/me/blocks/{player_id}')
async def unblock(player_id:str,request:Request,user=Depends(current_user)):
    return await change(request,user,player_id,False)
