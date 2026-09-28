#!/usr/bin/env python3
"""Copy allowlisted diagnostics to Alloy-readable files without Docker socket access.

Runs as a root oneshot with fixed source paths. Bounded reads, persisted offsets,
no historical backfill on first encounter. Rotation/recreation uses inode identity.
Telemetry is best effort, not an audit log. Never copy raw SQL or exception text.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone

FIELDS = frozenset(('event', 'timestamp', 'level', 'lane_id', 'room_id', 'table_id',
                    'game_id', 'command_id', 'sequence', 'job_id', 'epoch',
                    'error_type', 'result', 'operation', 'lane_kind', 'retrying', 'game_type'))
TOKEN = re.compile(r'^[a-zA-Z0-9_.:-]{1,128}$')
BUDGET = 2 * 1024 * 1024
STATE = Path('/var/lib/bhidne-monitoring/offsets.json')
OUTPUT = Path('/var/log/bhidne-monitoring/events.jsonl')


def sanitize(role, line):
    if role == 'apps':
        try:
            envelope = json.loads(line)
            entry = json.loads(envelope['log'])
        except (ValueError, KeyError, TypeError):
            return None
        if not isinstance(entry, dict) or not TOKEN.fullmatch(str(entry.get('event', ''))):
            return None
        if entry.get('level') not in ('debug', 'info', 'warning', 'error', 'critical'):
            return None
        # Independent allowlist: only scalar identifiers/static diagnostic fields.
        return {k: v for k, v in entry.items() if k in FIELDS and
                (type(v) in (int, bool) or isinstance(v, str) and TOKEN.fullmatch(v))}
    if role == 'postgres':
        match = re.search(r'\[\d+\] (ERROR|FATAL|PANIC|WARNING|LOG):', line)
        if match:
            return {'event': 'postgres_log', 'level': match[1].lower()}
    if role == 'redis':
        match = re.match(r'^\d+:[A-Z] .*? ([*#-]) ', line)
        if match:
            # Redis logs can contain commands; forward severity, never raw text.
            return {'event': 'redis_log', 'level': 'warning' if match[1] == '#' else 'info'}
    return None


def read_new(path, offsets, role, output):
    with path.open('rb') as source:
        stat = os.fstat(source.fileno())
        identity = f'{stat.st_dev}:{stat.st_ino}'
        offset = offsets.get(identity, stat.st_size)
        if offset > stat.st_size:
            offset = 0
        source.seek(offset)
        consumed = 0
        while consumed < BUDGET:
            start = source.tell()
            raw = source.readline(65537)
            if not raw:
                break
            if not raw.endswith(b'\n'):
                if len(raw) <= 65536:
                    source.seek(start)  # Retry incomplete line next invocation.
                    break
                # Discard oversized lines entirely, never parse their suffix.
                source.seek(stat.st_size)
                break
            consumed += len(raw)
            record = sanitize(role, raw.decode('utf-8', errors='replace'))
            if record:
                record['collected_at'] = datetime.now(timezone.utc).isoformat()
                output.write(json.dumps(record, separators=(',', ':')) + '\n')
        return identity, source.tell()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('role', choices=('apps', 'postgres', 'redis'))
    role = parser.parse_args().role
    if role == 'apps':
        result = subprocess.run(['docker', 'inspect', '--format', '{{.LogPath}}',
                                 'bhidne-prod-app'], capture_output=True, text=True, timeout=5)
        if result.returncode:
            raise SystemExit('Application container unavailable; will retry on next timer.')
        path = Path(result.stdout.strip())
        if not path.is_absolute() or not str(path).startswith('/var/lib/docker/containers/'):
            raise SystemExit('Expected Docker json-file logging path.')
        paths = [path]
    else:
        paths = [Path('/var/log/postgresql/postgresql-17-main.log') if role == 'postgres'
                 else Path('/var/log/redis/redis-server.log')]
    offsets = json.loads(STATE.read_text()) if STATE.exists() else {}
    # Bound local disk to three 5 MiB files; Alloy tails the active file.
    if OUTPUT.exists() and OUTPUT.stat().st_size >= 5 * 1024 * 1024:
        old = OUTPUT.with_suffix('.jsonl.1')
        if old.exists():
            old.replace(OUTPUT.with_suffix('.jsonl.2'))
        OUTPUT.replace(old)
    updated = {}
    fd = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o640)
    with os.fdopen(fd, 'a') as output:
        for path in paths:
            identity, offset = read_new(path, offsets, role, output)
            updated[identity] = offset
        output.flush()
        os.fsync(output.fileno())
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(updated))
    temporary.replace(STATE)


if __name__ == '__main__':
    main()
