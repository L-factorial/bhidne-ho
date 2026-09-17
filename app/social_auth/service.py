from app.social_auth.verifiers import ProviderVerificationError


class SocialAuthError(Exception):
    pass


class ProviderNotConfiguredError(SocialAuthError):
    pass


class SocialAuthService:
    def __init__(self, verifiers, store):
        self.verifiers, self.store = dict(verifiers), store

    def providers(self):
        return sorted(self.verifiers)

    async def login(self, provider: str, credential: str, nonce: str | None = None):
        verifier = self.verifiers.get(provider)
        if verifier is None:
            raise ProviderNotConfiguredError(f"{provider.title()} sign-in is not configured")
        try:
            identity = await verifier.verify(credential, nonce)
        except ProviderVerificationError as error:
            raise SocialAuthError(str(error)) from None
        if identity.provider != provider:
            raise SocialAuthError("Provider identity does not match the requested provider")
        return await self.store.login(identity)
