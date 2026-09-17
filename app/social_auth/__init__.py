"""Provider authentication isolated from application sessions and game code."""

from app.social_auth.service import SocialAuthError, SocialAuthService

__all__ = ["SocialAuthError", "SocialAuthService"]
