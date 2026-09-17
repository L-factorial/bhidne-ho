import os
from dataclasses import dataclass


def _list(name: str) -> tuple[str, ...]:
    return tuple(value.strip() for value in os.environ.get(name, "").split(",") if value.strip())


@dataclass(frozen=True)
class SocialAuthConfig:
    google_client_ids: tuple[str, ...]
    apple_client_ids: tuple[str, ...]
    facebook_app_id: str
    facebook_app_secret: str

    @classmethod
    def from_environment(cls):
        return cls(
            google_client_ids=_list("GOOGLE_CLIENT_IDS"),
            apple_client_ids=_list("APPLE_CLIENT_IDS"),
            facebook_app_id=os.environ.get("FACEBOOK_APP_ID", "").strip(),
            facebook_app_secret=os.environ.get("FACEBOOK_APP_SECRET", "").strip(),
        )
