import os
from dataclasses import dataclass


def _value(name: str, legacy: str) -> str:
    return os.environ.get(name) or os.environ.get(legacy, "")


def _list(name: str, legacy: str) -> tuple[str, ...]:
    return tuple(value.strip() for value in _value(name, legacy).split(",") if value.strip())


@dataclass(frozen=True)
class SocialAuthConfig:
    google_client_ids: tuple[str, ...]
    apple_client_ids: tuple[str, ...]
    facebook_app_id: str
    facebook_app_secret: str

    @classmethod
    def from_environment(cls):
        return cls(
            google_client_ids=_list("BHIDNE_HO_GOOGLE_CLIENT_IDS", "GOOGLE_CLIENT_IDS"),
            apple_client_ids=_list("BHIDNE_HO_APPLE_CLIENT_IDS", "APPLE_CLIENT_IDS"),
            facebook_app_id=_value("BHIDNE_HO_FACEBOOK_APP_ID", "FACEBOOK_APP_ID").strip(),
            facebook_app_secret=_value("BHIDNE_HO_FACEBOOK_APP_SECRET", "FACEBOOK_APP_SECRET").strip(),
        )
