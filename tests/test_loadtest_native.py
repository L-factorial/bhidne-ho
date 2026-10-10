"""Real load-driver smoke; opt-in disposable two-gateway cluster."""
import asyncio
import json
import pytest
from pathlib import Path

from distributed_process_support import cluster


async def test_load_driver_all_games(cluster, tmp_path):
    script = 'scripts/loadtest/run.mts'
    credentials = str(tmp_path / 'accounts.jsonl')
    output = str(tmp_path / 'results')

    async def run(*args):
        process = await asyncio.create_subprocess_exec(
            'node', '--experimental-strip-types', script,
            '--accounts', credentials, '--output', output, *args,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        try:
            communication = asyncio.create_task(process.communicate())
            try:
                text, _ = await asyncio.wait_for(asyncio.shield(communication), 480)
            except TimeoutError:
                process.kill()
                text, _ = await communication
                reports = [p.read_text() for p in Path(output).glob('*.jsonl')] if Path(output).exists() else []
                pytest.fail('Load driver timed out: ' + text.decode() + '\n' + '\n'.join(reports)[-5000:])
            reports = [p.read_text() for p in Path(output).glob('*.jsonl')] if Path(output).exists() else []
            assert process.returncode == 0, text.decode() + '\n' + '\n'.join(reports)[-5000:]
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()

    await run('--mode', 'generate', '--count', '12')
    await run('--mode', 'provision', '--url', cluster.urls[0], '--users', '4')
    rows = Path(credentials).read_text().splitlines()

    async def play(game, index):
        subset = tmp_path / f'{game}.jsonl'
        subset.write_text('\n'.join(rows[index * 4:(index + 1) * 4]) + '\n')
        subset.chmod(0o600)
        await run('--accounts', str(subset), '--url', cluster.urls[1], '--users', '4', '--seconds', '400',
                  '--ramp', '0', '--late', '0', '--games', game, '--max-games', '1')
        reports = [json.loads(p.read_text()) for p in Path(output).glob('*.json')]
        assert any(r.get('counters', {}).get(f'games.{game}.validated') == 1 for r in reports)

    results = await asyncio.gather(*(play(game, i) for i, game in enumerate(('flush', 'marriage', 'callbreak'))), return_exceptions=True)
    for result in results:
        if isinstance(result, BaseException):
            raise result


async def test_load_driver_concurrent(cluster, tmp_path):
    """Three exclusive four-user cohorts, including deliberately late actions."""
    credentials = str(tmp_path / 'accounts.jsonl')
    output = str(tmp_path / 'results')
    for args in (
        ('--mode', 'generate', '--count', '12'),
        ('--mode', 'provision', '--url', cluster.urls[0]),
        ('--url', cluster.urls[1], '--seconds', '120', '--ramp', '0',
         '--games', 'flush', '--max-games', '3', '--late', '0.1'),
    ):
        process = await asyncio.create_subprocess_exec(
            'node', '--experimental-strip-types', 'scripts/loadtest/run.mts',
            '--accounts', credentials, '--output', output, '--users', '12', *args,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        try:
            text, _ = await asyncio.wait_for(process.communicate(), 240)
            events = '\n'.join(p.read_text() for p in Path(output).glob('*.jsonl')) if Path(output).exists() else ''
            assert process.returncode == 0, text.decode() + events[-6000:]
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
    reports = [json.loads(p.read_text()) for p in Path(output).glob('*.json')]
    result = next(r for r in reports if r['mode'] == 'run')
    assert result['unique_accounts'] == 12
    assert result['counters']['scenarios.completed'] == 3
    assert result['counters']['games.flush.validated'] == 3
    assert result['counters']['moves.deliberately_late'] > 0
