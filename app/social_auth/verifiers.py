from abc import ABC, abstractmethod
import hashlib
import hmac

import httpx
import jwt

from app.social_auth.models import VerifiedIdentity


class ProviderVerificationError(Exception):
    pass


class ProviderVerifier(ABC):
    provider: str

    @abstractmethod
    async def verify(self, credential: str, nonce: str | None = None) -> VerifiedIdentity: ...


class OpenIdTokenVerifier(ProviderVerifier):
    def __init__(self, audiences, issuer, jwks_url, provider, client=None):
        self.audiences, self.issuer, self.jwks_url, self.provider = tuple(audiences), issuer, jwks_url, provider
        self.client = client

    async def verify(self, credential: str, nonce: str | None = None) -> VerifiedIdentity:
        try:
            header = jwt.get_unverified_header(credential)
            if self.client:
                response = await self.client.get(self.jwks_url)
            else:
                async with httpx.AsyncClient(timeout=5) as client:
                    response = await client.get(self.jwks_url)
            response.raise_for_status()
            key_data = next(key for key in response.json()["keys"] if key.get("kid") == header.get("kid"))
            key = jwt.PyJWK.from_dict(key_data).key
            claims = jwt.decode(
                credential, key, algorithms=["RS256"], audience=self.audiences,
                issuer=self.issuer, options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
            if nonce is not None and not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
                raise ProviderVerificationError("Identity token nonce does not match")
        except ProviderVerificationError:
            raise
        except (httpx.HTTPError, jwt.PyJWTError, KeyError, StopIteration, TypeError, ValueError) as error:
            raise ProviderVerificationError("Provider rejected the identity token") from error
        name = " ".join(str(claims.get("name", "")).split())[:25]
        return VerifiedIdentity(
            provider=self.provider, subject=str(claims["sub"]), email=claims.get("email"),
            email_verified=claims.get("email_verified") is True or claims.get("email_verified") == "true",
            display_name=name,
        )


class FacebookTokenVerifier(ProviderVerifier):
    provider = "facebook"

    def __init__(self, app_id: str, app_secret: str, client=None):
        self.app_id, self.app_secret = app_id, app_secret
        self.client = client

    async def verify(self, credential: str, nonce: str | None = None) -> VerifiedIdentity:
        proof = hmac.new(self.app_secret.encode(), credential.encode(), hashlib.sha256).hexdigest()
        try:
            async def requests(client):
                debug = await client.get("https://graph.facebook.com/debug_token", params={
                    "input_token": credential, "access_token": f"{self.app_id}|{self.app_secret}",
                })
                debug.raise_for_status()
                data = debug.json()["data"]
                if data.get("is_valid") is not True or str(data.get("app_id")) != self.app_id:
                    raise ProviderVerificationError("Facebook rejected the access token")
                profile = await client.get("https://graph.facebook.com/me", params={
                    "fields": "id,name,email", "access_token": credential, "appsecret_proof": proof,
                })
                return data, profile
            if self.client:
                data, profile = await requests(self.client)
            else:
                async with httpx.AsyncClient(timeout=5) as client:
                    data, profile = await requests(client)
            profile.raise_for_status()
            claims = profile.json()
            if str(claims.get("id")) != str(data.get("user_id")):
                raise ProviderVerificationError("Facebook token subject does not match")
        except ProviderVerificationError:
            raise
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
            raise ProviderVerificationError("Facebook could not verify the access token") from error
        return VerifiedIdentity(provider="facebook", subject=str(claims["id"]), email=claims.get("email"),
                                email_verified=False,
                                display_name=" ".join(str(claims.get("name", "")).split())[:25])


def configured_verifiers(config, client=None):
    result = {}
    if config.google_client_ids:
        result["google"] = OpenIdTokenVerifier(config.google_client_ids,
            ("https://accounts.google.com", "accounts.google.com"),
            "https://www.googleapis.com/oauth2/v3/certs", "google", client)
    if config.apple_client_ids:
        result["apple"] = OpenIdTokenVerifier(config.apple_client_ids, "https://appleid.apple.com",
            "https://appleid.apple.com/auth/keys", "apple", client)
    if config.facebook_app_id and config.facebook_app_secret:
        result["facebook"] = FacebookTokenVerifier(config.facebook_app_id, config.facebook_app_secret, client)
    return result
