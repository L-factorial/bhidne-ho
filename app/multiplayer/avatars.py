"""Preset identifiers refer to bundled client assets; no image bytes are stored."""
AVATAR_IDS = frozenset(f'{category}_{number:02d}' for category in ('male', 'female') for number in range(1, 16))


def avatar_url(identifier):
    return f'preset:{identifier}' if identifier in AVATAR_IDS else None
