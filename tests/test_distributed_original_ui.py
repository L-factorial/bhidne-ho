"""Original frontend contracts exercised against disposable native gateways."""
import asyncio
import os
import shutil

import pytest
from distributed_process_support import cluster


async def test_original_ui_adapters_against_native_cluster(cluster):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node 22+ is required for original UI adapter acceptance.')
    process = await asyncio.create_subprocess_exec(
        node, '--experimental-strip-types', 'tests/original-ui-acceptance.mts',
        env={**os.environ, 'ORIGINAL_UI_TEST_URL': cluster.urls[1]},
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), 600)
        assert process.returncode == 0, output.decode()[-8000:]
        assert output.count(b'PASS') == 7, output.decode()
        for line in output.decode().splitlines():
            if line.startswith('TIMING'):
                print(line)
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
