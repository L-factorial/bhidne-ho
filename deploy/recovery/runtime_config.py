"""Merge only recovery settings into an existing Docker runtime environment."""
import json
import os
from pathlib import Path
import sys
import tempfile

PREFIX = 'BHIDNE_HO_RECOVERY_'
NAMES = {'ENABLED', 'PUBLIC_ORIGIN', 'FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS',
         'SMTP_USERNAME', 'SMTP_PASSWORD', 'KEYS'}


def merge(existing, values):
    if not isinstance(values, dict) or set(values) != {PREFIX + name for name in NAMES}:
        raise ValueError('Invalid recovery settings.')
    if any(not isinstance(v, str) or not v or v != v.strip() or any(c in v for c in '\r\n\0') for v in values.values()):
        raise ValueError('Recovery settings must contain nonempty single-line values.')
    kept = [line for line in existing.splitlines() if not line.startswith(PREFIX)]
    return '\n'.join(kept + [key + '=' + value for key, value in sorted(values.items())]) + '\n'


def install(path, values):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected an existing regular runtime environment.')
    existing = path.read_text()
    content = merge(existing, values)
    if content == existing:
        return False
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.recovery-config-')
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as output:
            output.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


if __name__ == '__main__':
    try:
        changed = install(Path('/etc/bhidne-prod/runtime.env'), json.load(sys.stdin))
        print('Recovery settings installed.' if changed else 'Recovery settings already match.')
    except Exception:
        sys.exit('Recovery configuration failed; no credential values printed.')
