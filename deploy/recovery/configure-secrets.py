#!/usr/bin/env python3
"""Prepare private production recovery settings; does not deploy or send mail."""
import getpass
import json
import os
from pathlib import Path
import tempfile

from cryptography.fernet import Fernet

DESTINATION = Path(__file__).resolve().parents[1] / 'provision/recovery.local.yml'


def save(path, token):
    if not token.startswith('re_') or any(c.isspace() for c in token):
        raise ValueError('Expected a Resend API key without whitespace.')
    if path.is_symlink():
        raise ValueError('Refusing a symbolic-link secrets destination.')
    previous = json.loads(path.read_text()) if path.exists() else None
    # Preserve the encryption key on reruns; malformed existing files must never
    # silently replace keys that may still protect queued recovery messages.
    if previous is not None:
        keys = previous['recovery_environment']['BHIDNE_HO_RECOVERY_KEYS']
        for key in keys.split(','):
            Fernet(key.strip().encode())
    else:
        keys = Fernet.generate_key().decode()
    data = {'recovery_environment': {
        'BHIDNE_HO_RECOVERY_ENABLED': '1',
        'BHIDNE_HO_RECOVERY_PUBLIC_ORIGIN': 'https://prod.bhidne-ho.lfactorial.com',
        'BHIDNE_HO_RECOVERY_FROM': 'accounts@notify.lfactorial.com',
        'BHIDNE_HO_RECOVERY_SMTP_HOST': 'smtp.resend.com',
        'BHIDNE_HO_RECOVERY_SMTP_PORT': '2587',
        'BHIDNE_HO_RECOVERY_SMTP_TLS': 'starttls',
        'BHIDNE_HO_RECOVERY_SMTP_USERNAME': 'resend',
        'BHIDNE_HO_RECOVERY_SMTP_PASSWORD': token,
        'BHIDNE_HO_RECOVERY_KEYS': keys,
    }}
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.recovery-secret-')
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as output:
            json.dump(data, output, indent=2)
            output.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    try:
        token = getpass.getpass('Resend bhidne-ho-prod API key (hidden): ').strip()
        save(DESTINATION, token)
    except (ValueError, KeyError, TypeError, OSError):
        raise SystemExit('Could not save recovery settings. Check the key and any existing private configuration; no values were printed.') from None
    print('Saved private settings to deploy/provision/recovery.local.yml (Git ignored, owner-only access).')
    print('No server configuration was changed and no email was sent.')


if __name__ == '__main__':
    main()
