"""Privacy and cursor regression tests for privileged monitoring log collection."""
import importlib.util
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('monitoring_bridge', ROOT / 'deploy/monitoring/log-bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def app_line(**extra):
    entry = dict(event='command_submitted', level='info', command_id='abc-123', **extra)
    return json.dumps({'log': json.dumps(entry) + '\n'}) + '\n'


def test_app_payload_credentials_and_exception_text_never_exported():
    result = bridge.sanitize('apps', app_line(password='secret', message='SQL secret', cards=[1],
                                             exception='Bearer secret', operation='submit.game'))
    assert result == dict(event='command_submitted', level='info', command_id='abc-123', operation='submit.game')
    assert bridge.sanitize('apps', 'raw exception secret') is None
    assert bridge.sanitize('apps', json.dumps({'log': '[]'})) is None


def test_raw_database_details_never_exported():
    assert bridge.sanitize('postgres', '2026-09-28 UTC [123] ERROR: password=secret') == {
        'event': 'postgres_log', 'level': 'error'}
    assert bridge.sanitize('postgres', '2026 UTC [123] STATEMENT: SELECT secret') is None
    assert bridge.sanitize('redis', '123:M 28 Sep 2026 00:00:00.000 # secret command') == {
        'event': 'redis_log', 'level': 'warning'}


def test_offsets_skip_backfill_resume_and_wait_for_complete_line(tmp_path):
    path = tmp_path / 'docker.log'
    path.write_text(app_line())
    output = io.StringIO()
    identity, offset = bridge.read_new(path, {}, 'apps', output)
    assert output.getvalue() == ''
    with path.open('a') as f:
        f.write(app_line() + '{"log":')
    _, next_offset = bridge.read_new(path, {identity: offset}, 'apps', output)
    assert len(output.getvalue().splitlines()) == 1
    assert next_offset == offset * 2
    output = io.StringIO()
    bridge.read_new(path, {identity: next_offset}, 'apps', output)
    assert output.getvalue() == ''


def test_truncated_file_and_oversized_lines(tmp_path):
    path = tmp_path / 'docker.log'
    path.write_text(app_line())
    stat = path.stat()
    identity = f'{stat.st_dev}:{stat.st_ino}'
    output = io.StringIO()
    bridge.read_new(path, {identity: 10000}, 'apps', output)
    assert len(output.getvalue().splitlines()) == 1
    path.write_text('x' * 70000 + app_line())
    output = io.StringIO()
    _, offset = bridge.read_new(path, {identity: 0}, 'apps', output)
    assert output.getvalue() == ''
    assert offset == path.stat().st_size
