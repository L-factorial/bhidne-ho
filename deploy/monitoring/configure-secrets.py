#!/usr/bin/env python3
"""Prompt locally; never put ingestion credentials in shell history or Git."""
import getpass
import json
import os
from pathlib import Path
import secrets
import tempfile


def main():
    path = Path(__file__).resolve().parents[1] / 'provision/monitoring.local.yml'
    previous = json.loads(path.read_text()) if path.exists() else {}
    token = getpass.getpass('Grafana ingestion token (hidden; metrics:write and logs:write): ').strip()
    if not token or any(c.isspace() for c in token):
        raise SystemExit('Token must be nonempty and contain no whitespace.')
    data = {
        'grafana_metrics_token': token,
        'grafana_logs_token': token,
        'redis_monitor_password': previous.get('redis_monitor_password', secrets.token_hex(32)),
    }
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.monitoring-secret-')
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as output:
            json.dump(data, output, indent=2)
            output.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('Saved protected credentials to deploy/provision/monitoring.local.yml (Git ignored).')


if __name__ == '__main__':
    main()
