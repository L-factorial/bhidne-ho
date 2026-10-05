from typing import Literal
from uuid import UUID
import re
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.transport.http import current_user

router=APIRouter()
CONTRACTS={('GET','/auth/push/capabilities'),('GET','/me/push/preferences'),('PATCH','/me/push/preferences'),
    ('POST','/me/push/devices/{device_id}'),('DELETE','/me/push/devices/{device_id}'),('POST','/me/push/devices/{device_id}/activity')}
class Preferences(BaseModel):
    model_config=ConfigDict(extra='forbid')
    actions:bool=True
    invitations:bool=True
    sound:bool=True
    quiet_start:int|None=Field(default=None,ge=0,le=1439)
    quiet_end:int|None=Field(default=None,ge=0,le=1439)
    @model_validator(mode='after')
    def hours(self):
        if (self.quiet_start is None)!=(self.quiet_end is None) or self.quiet_start is not None and self.quiet_start==self.quiet_end:
            raise ValueError('Choose distinct start and end quiet hours, or disable both.')
        return self
class Device(BaseModel):
    model_config=ConfigDict(extra='forbid')
    provider:Literal['apns','fcm']
    token:str=Field(min_length=32,max_length=4096)
    environment:Literal['production','development']='production'
    locale:Literal['en','ne']='en'
    timezone_offset:int=Field(default=0,ge=-840,le=840)
    @model_validator(mode='after')
    def native_token(self):
        pattern=r'[0-9a-fA-F]{64}' if self.provider=='apns' else r'[A-Za-z0-9_:\-]{32,4096}'
        if not re.fullmatch(pattern,self.token):raise ValueError('Invalid native push token.')
        return self
class Activity(BaseModel):
    model_config=ConfigDict(extra='forbid')
    foreground:bool
    viewed_match:str|None=Field(default=None,max_length=128,pattern=r'^[A-Za-z0-9_-]+$')
    timezone_offset:int=Field(default=0,ge=-840,le=840)
    locale:Literal['en','ne']='en'

def service(request,response):
    response.headers['Cache-Control']='no-store'
    value=getattr(request.app.state,'push',None)
    if value is None:raise HTTPException(503,'App notifications are unavailable in this runtime.')
    return value

@router.get('/auth/push/capabilities')
async def capabilities(request:Request,response:Response):
    response.headers['Cache-Control']='no-store'
    value=getattr(request.app.state,'push',None)
    return {'providers':value.providers.available if value else []}
@router.get('/me/push/preferences')
async def preferences(request:Request,response:Response,user=Depends(current_user)):
    return await service(request,response).preferences(user.user_id)
@router.patch('/me/push/preferences')
async def preferences_updated(body:Preferences,request:Request,response:Response,user=Depends(current_user)):
    return await service(request,response).update_preferences(user.user_id,body)
@router.post('/me/push/devices/{device_id}')
async def registered(device_id:UUID,body:Device,request:Request,response:Response,user=Depends(current_user)):
    token=request.headers.get('authorization','').removeprefix('Bearer ')
    return await service(request,response).register(user.user_id,token,device_id,body)
@router.delete('/me/push/devices/{device_id}')
async def removed(device_id:UUID,request:Request,response:Response,user=Depends(current_user)):
    await service(request,response).unregister(user.user_id,device_id)
    return {'removed':True}
@router.post('/me/push/devices/{device_id}/activity')
async def active(device_id:UUID,body:Activity,request:Request,response:Response,user=Depends(current_user)):
    return await service(request,response).activity(user.user_id,device_id,body)
