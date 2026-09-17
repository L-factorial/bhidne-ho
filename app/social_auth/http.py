from fastapi import APIRouter, HTTPException, Request, Response

from app.auth.models import GuestCredentials
from app.social_auth.models import Provider, ProviderCredential
from app.social_auth.service import ProviderNotConfiguredError, SocialAuthError

router = APIRouter(prefix="/auth/social", tags=["Social authentication"])


@router.get("/providers")
async def providers(request: Request):
    return {"providers": request.app.state.social_auth.providers()}


@router.post("/{provider}", response_model=GuestCredentials)
async def social_login(provider: Provider, body: ProviderCredential, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await request.app.state.social_auth.login(provider, body.credential, body.nonce)
    except ProviderNotConfiguredError as error:
        raise HTTPException(503, str(error)) from None
    except SocialAuthError as error:
        raise HTTPException(401, str(error)) from None
