"""Append an allowlisted JSON deployment secret to a private Compose env file.

Never print configuration values. An absent secret keeps email recovery disabled.
"""
import json
import os
from pathlib import Path
import sys

ALLOWED = {
    'BHIDNE_HO_RECOVERY_ENABLED', 'BHIDNE_HO_RECOVERY_PUBLIC_ORIGIN',
    'BHIDNE_HO_RECOVERY_FROM', 'BHIDNE_HO_RECOVERY_KEYS',
    'BHIDNE_HO_RECOVERY_SMTP_HOST', 'BHIDNE_HO_RECOVERY_SMTP_PORT',
    'BHIDNE_HO_RECOVERY_SMTP_TLS', 'BHIDNE_HO_RECOVERY_SMTP_USERNAME',
    'BHIDNE_HO_RECOVERY_SMTP_PASSWORD',
}


def render(raw):
    try:
        values = json.loads(raw or '{}')
        if not isinstance(values, dict) or set(values) - ALLOWED:
            raise ValueError()
        if any(not isinstance(value, str) or any(char in value for char in "\r\n\0'") for value in values.values()):
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('Recovery configuration must be a JSON object of allowed single-line string settings.') from None
    # Single quotes suppress dotenv interpolation of dollar signs in secrets.
    return ''.join(f"{key}='{value}'\n" for key, value in sorted(values.items()))


if __name__ == '__main__':
    try:
        content = render(os.environ.get('RECOVERY_CONFIG', ''))
    except ValueError as error:
        sys.exit(str(error))
    with Path(sys.argv[1]).open('a') as target:
        target.write(content)
