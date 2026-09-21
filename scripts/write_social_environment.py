"""Append an allowlisted JSON deployment secret to a private Compose env file.

Never print configuration values. An absent secret keeps provider login disabled.
"""
import json
import os
from pathlib import Path
import sys

ALLOWED = {
    'BHIDNE_HO_SOCIAL_ENABLED_PROVIDERS', 'BHIDNE_HO_SOCIAL_PUBLIC_URL',
    'BHIDNE_HO_SOCIAL_REDIRECT_URIS', 'BHIDNE_HO_GOOGLE_WEB_CLIENT_ID',
    'BHIDNE_HO_GOOGLE_WEB_CLIENT_SECRET', 'BHIDNE_HO_APPLE_SERVICE_ID',
    'BHIDNE_HO_APPLE_CLIENT_SECRET', 'BHIDNE_HO_FACEBOOK_APP_ID',
    'BHIDNE_HO_FACEBOOK_APP_SECRET', 'BHIDNE_HO_FACEBOOK_GRAPH_VERSION',
}


def render(raw):
    try:
        values = json.loads(raw or '{}')
        if not isinstance(values, dict) or set(values) - ALLOWED:
            raise ValueError()
        if any(not isinstance(value, str) or any(char in value for char in "\r\n\0'") for value in values.values()):
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('Social configuration must be a JSON object of allowed single-line string settings.') from None
    # Single quotes suppress dotenv interpolation of dollar signs in secrets.
    return ''.join(f"{key}='{value}'\n" for key, value in sorted(values.items()))


if __name__ == '__main__':
    try:
        content = render(os.environ.get('SOCIAL_CONFIG', ''))
    except ValueError as error:
        sys.exit(str(error))
    with Path(sys.argv[1]).open('a') as target:
        target.write(content)
