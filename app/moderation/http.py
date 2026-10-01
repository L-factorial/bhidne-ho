from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.transport.http import current_user
from app.durable_games.queries import QueryAccessDenied
from .service import ReportLimit, ReviewConflict
from .actions import ModerationActions, ParticipationConflict
from .policy import accept_rules, status, RULES_VERSION

router=APIRouter()
CONTRACTS={('GET','/auth/moderation/capabilities'),('POST','/me/reports'),('GET','/moderation/users'),
    ('GET','/me/community-rules'),('POST','/me/community-rules'),
    ('GET','/moderation/users/{player_id}/actions'),('POST','/moderation/reports/{report_id}/actions'),
    ('GET','/moderation/users/{player_id}/reports'),('POST','/moderation/reports/{report_id}/decision')}

class ReportInput(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    reported_user_id: str=Field(max_length=64)
    scope: Literal['player','direct','chat']='player'
    message_id: UUID|None=None
    category: Literal['harassment','hate','sexual','spam','other']
    explanation: str=Field(default='',max_length=1000)
    @model_validator(mode='after')
    def scope_message(self):
        if (self.scope=='player') != (self.message_id is None): raise ValueError('A message report needs a message ID.')
        return self

class DecisionInput(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    decision: Literal['accepted','declined']
    reason: str=Field(min_length=1,max_length=1000)

def service(request):
    value=getattr(request.app.state,'moderation',None)
    if value is None: raise HTTPException(503,'Moderation unavailable.')
    return value

async def call(pending):
    try: return await pending
    except QueryAccessDenied: raise HTTPException(403,'Access unavailable.') from None
    except (ValueError,AttributeError): raise HTTPException(422,'Invalid report data.') from None
    except ReportLimit: raise HTTPException(429,'Report limit reached. Try again later.') from None
    except ParticipationConflict: raise HTTPException(409,'Player must leave active tables first. Mute chat immediately if needed.') from None
    except ReviewConflict: raise HTTPException(409,'This report has already been reviewed. Refresh the list.') from None

@router.get('/auth/moderation/capabilities')
async def capabilities(request:Request,response:Response,user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    if getattr(request.app.state,'moderation',None) is None: return dict(reporting=False,moderator=False)
    return await call(service(request).capabilities(user.user_id))

@router.post('/me/reports',status_code=201)
async def report(body:ReportInput,request:Request,response:Response,user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    return await call(service(request).submit(user.user_id,body.reported_user_id,body.scope,body.message_id,body.category,body.explanation))

@router.get('/moderation/users')
async def groups(request:Request,response:Response,reviewed:bool=False,after:UUID|None=None,limit:int=Query(30,ge=1,le=100),user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    return await call(service(request).groups(user.user_id,reviewed,str(after) if after else None,limit))

@router.get('/moderation/users/{player_id}/reports')
async def reports(player_id:str,request:Request,response:Response,reviewed:bool=False,after:UUID|None=None,limit:int=Query(30,ge=1,le=100),user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    return await call(service(request).reports(user.user_id,player_id,reviewed,str(after) if after else None,limit))

@router.post('/moderation/reports/{report_id}/decision')
async def decide(report_id:UUID,body:DecisionInput,request:Request,response:Response,user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    return await call(service(request).decide(user.user_id,report_id,body.decision,body.reason))


class RulesInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    version: str=Field(max_length=30)
    accepted: Literal[True]

class ActionInput(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_id: UUID
    action: Literal['remove_message','mute','unmute','suspend','unsuspend']
    reason: str=Field(min_length=1,max_length=1000)
    hours: Literal[1,24,168,720]=24

@router.get('/me/community-rules')
async def community_status(request:Request,response:Response,user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    return await call(status(service(request).pool,user.user_id))

@router.post('/me/community-rules')
async def community_accept(body:RulesInput,request:Request,response:Response,user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    await call(accept_rules(service(request).pool,user.user_id,body.version))
    return {'version':RULES_VERSION,'accepted':True}

@router.post('/moderation/reports/{report_id}/actions')
async def action(report_id:UUID,body:ActionInput,request:Request,response:Response,user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    return await call(ModerationActions(service(request)).apply(user.user_id,report_id,body.action,body.reason,body.request_id,body.hours))

@router.get('/moderation/users/{player_id}/actions')
async def actions(player_id:str,request:Request,response:Response,user=Depends(current_user)):
    response.headers['Cache-Control']='no-store'
    return await call(ModerationActions(service(request)).history(user.user_id,player_id))
