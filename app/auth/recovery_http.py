"""Public recovery API: no challenge credentials or account-existence disclosures."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from app.auth.email import normalize_recovery_email
from app.auth.recovery import InvalidRecoveryChallenge, RecoveryRateLimited
from app.auth.service import AuthenticationError
from app.transport.http import current_user


def no_store(response: Response):
    response.headers['Cache-Control'] = 'no-store'


router = APIRouter(prefix='/auth/recovery', dependencies=[Depends(no_store)])
CONTRACTS = {('GET', '/auth/recovery/capabilities'), ('GET', '/auth/recovery/email'),
    ('POST', '/auth/recovery/email'), ('DELETE', '/auth/recovery/email'),
    ('POST', '/auth/recovery/verify'), ('POST', '/auth/recovery/reset/request'),
    ('POST', '/auth/recovery/reset/complete'), ('POST', '/auth/recovery/username/request')}


class PasswordProof(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)


class Enroll(PasswordProof):
    email: str = Field(min_length=3, max_length=254)
    _email = field_validator('email')(normalize_recovery_email)


class ResetRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class UsernameRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    _email = field_validator('email')(normalize_recovery_email)


class Challenge(BaseModel):
    token: str = Field(min_length=43, max_length=43, pattern=r'^[A-Za-z0-9_-]+$')


class ResetComplete(Challenge):
    password: str = Field(min_length=8, max_length=128)


def failure(status, code):
    raise HTTPException(status, {'code': code}, headers={'Cache-Control': 'no-store'})


def runtime(request):
    value = request.app.state.recovery
    if not value.enabled:
        failure(503, 'recovery_unavailable')
    return value


async def limited(request, scope, user_id=None):
    value = runtime(request)
    async with value.pool.connection() as c:
        allowed = await value.budget(c, scope, request.client.host if request.client else 'unknown', 30, 600)
        if allowed and user_id:
            allowed = await value.budget(c, 'email-account', user_id, 10, 3600)
    if not allowed:
        failure(429, 'recovery_rate_limited')
    return value


@router.get('/capabilities')
async def capabilities(request: Request):
    return {'enabled': request.app.state.recovery.enabled}


@router.get('/email')
async def status(request: Request, user=Depends(current_user)):
    value = request.app.state.recovery
    result = await value.service.email_status(user.user_id) if value.service else {
        'password_account': False, 'verified_email': None, 'pending_email': None}
    return {**result, 'enabled': value.enabled}


@router.post('/email', status_code=202)
async def enroll(body: Enroll, request: Request, user=Depends(current_user)):
    value = await limited(request, 'email-ip', user.user_id)
    try:
        await value.service.enroll_email(user.user_id, body.current_password, body.email)
    except AuthenticationError:
        failure(403, 'recovery_password_incorrect')
    except RecoveryRateLimited:
        failure(429, 'recovery_rate_limited')
    return {'accepted': True}


@router.delete('/email', status_code=204)
async def remove(body: PasswordProof, request: Request, user=Depends(current_user)):
    value = await limited(request, 'email-ip', user.user_id)
    try:
        await value.service.remove_email(user.user_id, body.current_password)
    except AuthenticationError:
        failure(403, 'recovery_password_incorrect')


@router.post('/verify')
async def verify(body: Challenge, request: Request):
    value = await limited(request, 'verify-ip')
    try:
        await value.service.verify_email(body.token)
    except InvalidRecoveryChallenge:
        failure(400, 'recovery_link_invalid')
    return {'verified': True}


@router.post('/reset/request', status_code=202)
async def reset_request(body: ResetRequest, request: Request):
    value = runtime(request)
    await value.request_reset(body.username, request.client.host if request.client else 'unknown')
    return {'accepted': True}


@router.post('/username/request', status_code=202)
async def username_request(body: UsernameRequest, request: Request):
    value = runtime(request)
    await value.request_username(body.email, request.client.host if request.client else 'unknown')
    return {'accepted': True}


@router.post('/reset/complete')
async def reset_complete(body: ResetComplete, request: Request):
    value = await limited(request, 'complete-ip')
    try:
        await value.service.reset_password(body.token, body.password)
    except InvalidRecoveryChallenge:
        failure(400, 'recovery_link_invalid')
    return {'reset': True}


class RecoveryNoStore:
    """Include authentication/validation errors in the cache boundary too."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope.get('path', '').startswith(('/auth/recovery/', '/auth/deletion/')):
            return await self.app(scope, receive, send)
        async def no_cache(message):
            if message['type'] == 'http.response.start':
                headers = [(key,value) for key,value in message.get('headers', []) if key.lower() != b'cache-control']
                message = {**message, 'headers': headers + [(b'cache-control', b'no-store')]}
            await send(message)
        await self.app(scope, receive, no_cache)
