"""Export ephemeral browser fixtures; no server or database writes.

Run: .venv/bin/python scripts/social_browser_fixtures.py
Then serve a client web export and run client/tests/browser/table-social.cjs.
"""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
from test_room_pokes import social_table


async def main():
    for kind in ('callbreak', 'marriage', 'flush'):
        host, *_ = await social_table(kind)
        try:
            state = await host.snapshot('room', 'u0')
            Path(f'/tmp/bhidne-social-{kind}.json').write_text(json.dumps(state))
        finally:
            await host.close()


if __name__ == '__main__':
    asyncio.run(main())
