from collections import OrderedDict
from time import monotonic
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field

from app.social_auth.models import Provider

router = APIRouter(prefix='/auth/social/browser', tags=['Social authentication'])
HEADERS = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}


class StartInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    redirect_uri: str = Field(min_length=1, max_length=2048)


class CompleteInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_id: str = Field(min_length=32, max_length=128)
    secret: str = Field(min_length=32, max_length=128)
    handoff: str = Field(min_length=32, max_length=128)


def throttle(request):
    # Trust only the ASGI peer address, not arbitrary forwarded headers. Production
    # proxies must provide trusted client IPs and enforce an additional edge limit.
    limits = getattr(request.app.state, 'social_login_limits', None)
    if limits is None:
        limits = request.app.state.social_login_limits = OrderedDict()
    now = monotonic()
    key = request.client.host if request.client else 'unknown'
    count, reset = limits.pop(key, (0, now + 60))
    if reset <= now:
        count, reset = 0, now + 60
    limits[key] = (count + 1, reset)
    while len(limits) > 4096:
        limits.popitem(last=False)
    if count >= 60:
        raise HTTPException(429, 'Too many sign-in attempts. Please wait a minute.', headers={**HEADERS, 'Retry-After': '60'})


async def guarded(operation):
    try:
        return await operation
    except HTTPException as error:
        error.headers = {**(error.headers or {}), **HEADERS}
        raise


@router.get('/providers')
async def providers(request: Request):
    return JSONResponse({'providers': sorted(request.app.state.browser_social_auth.providers)}, headers=HEADERS)


@router.post('/{provider}/start')
async def start(provider: Provider, body: StartInput, request: Request):
    throttle(request)
    value = await guarded(request.app.state.browser_social_auth.start(provider, body.redirect_uri))
    return JSONResponse(value, headers=HEADERS)


@router.post('/complete')
async def complete(body: CompleteInput, request: Request):
    throttle(request)
    value = await guarded(request.app.state.browser_social_auth.complete(body.attempt_id, body.secret, body.handoff))
    return JSONResponse(value.model_dump(), headers=HEADERS)


@router.api_route('/{provider}/callback', methods=['GET', 'POST'])
async def callback(provider: Provider, request: Request):
    throttle(request)
    if request.method == 'POST':
        if request.headers.get('content-type', '').split(';')[0] != 'application/x-www-form-urlencoded':
            raise HTTPException(415, 'Unsupported callback format.', headers=HEADERS)
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 16384:
                raise HTTPException(413, 'Callback is too large.', headers=HEADERS)
        try:
            values = parse_qs(raw.decode('utf-8'), max_num_fields=20)
        except (UnicodeDecodeError, ValueError):
            raise HTTPException(400, 'Invalid callback.', headers=HEADERS) from None
    else:
        try:
            if len(request.url.query) > 16384:
                raise ValueError()
            values = parse_qs(request.url.query, max_num_fields=20)
        except ValueError:
            raise HTTPException(400, 'Invalid callback.', headers=HEADERS) from None
    if any(len(value) != 1 for value in values.values()):
        raise HTTPException(400, 'Ambiguous callback.', headers=HEADERS)
    fields = {key: value[0] for key, value in values.items()}
    target = await guarded(request.app.state.browser_social_auth.callback(provider, fields))
    return RedirectResponse(target, status_code=303, headers=HEADERS)
