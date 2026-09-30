from fastapi import APIRouter, Depends, Request, Response, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.auth.email import normalize_recovery_email
from app.transport.http import current_user
from app.auth.recovery_http import no_store
from .service import DeletionError

router = APIRouter(prefix='/auth/deletion', dependencies=[Depends(no_store)])
CONTRACTS = {('GET','/auth/deletion/capabilities'),('POST','/auth/deletion/request'),
             ('POST','/auth/deletion/email'),('POST','/auth/deletion/confirm'),('POST','/auth/deletion/status')}


class Confirm(BaseModel):
    model_config = ConfigDict(extra='forbid')
    confirmation: str = Field(pattern=r'^DELETE$')
    current_password: str = Field(default='', max_length=128)


class EmailRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1,max_length=64)
    email: str = Field(min_length=3,max_length=254)
    _normalize = field_validator('email')(normalize_recovery_email)


class Token(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token: str = Field(min_length=43,max_length=43,pattern=r'^[A-Za-z0-9_-]+$')


class ConfirmToken(Token):
    confirmation: str = Field(pattern=r'^DELETE$')


def runtime(request):
    value = request.app.state.deletion
    if not value.enabled:
        raise HTTPException(503,{'code':'deletion_unavailable'})
    return value


async def limited(request, scope='deletion-ip', maximum=20, seconds=600):
    value = runtime(request)
    async with value.pool.connection() as c:
        if not await value.recovery.budget(c,scope,request.client.host if request.client else 'unknown',maximum,seconds):
            raise HTTPException(429,{'code':'deletion_limited'})
    return value


async def guarded(operation):
    try:
        return await operation
    except DeletionError as error:
        raise HTTPException(409,{'code':'deletion_'+str(error)}) from None


@router.get('/capabilities')
async def capabilities(request: Request):
    return {'enabled':request.app.state.deletion.enabled,'backups_configured':False,'balances':'game_points'}


@router.post('/request',status_code=202)
async def request_deletion(body: Confirm,request: Request,user=Depends(current_user)):
    value = await limited(request)
    token = request.headers.get('authorization','').removeprefix('Bearer ')
    return await guarded(value.service.request(user.user_id,password=body.current_password,session_token=token))


@router.post('/email',status_code=202)
async def request_email(body: EmailRequest,request: Request):
    value = await limited(request)
    await value.recovery.request_deletion(body.username,body.email,request.client.host if request.client else 'unknown')
    return {'accepted':True}


@router.post('/confirm',status_code=202)
async def confirm(body: ConfirmToken,request: Request):
    value = await limited(request)
    return await guarded(value.service.request(token=body.token))


@router.post('/status')
async def status(body: Token,request: Request):
    value = await limited(request,'deletion-status-ip',120,60)
    return await guarded(value.service.status(body.token))
