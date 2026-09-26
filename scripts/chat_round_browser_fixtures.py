"""Export six real Flush round transitions for chat focus regression testing.

Usage: python scripts/chat_round_browser_fixtures.py [output.json]
Pass the output as ROUND_FIXTURE to client/tests/browser/chat-touch-focus.cjs.
Uses an isolated in-memory host; no server or database writes.
"""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]
from test_room_pokes import social_table
from app.test_games.http import GameAction


async def main(output):
    host, *_ = await social_table('flush')
    states = []
    try:
        match_id = host.games['room'].match_id
        for _ in range(6):
            start = await host.snapshot('room', 'u0')
            for _ in range(10):
                state = await host.snapshot('room', 'u0')
                status = state['flush']['public']['status']
                if status == 'finished':
                    break
                actor = state['game']['turn']['player_id']
                command = {'awaiting_deal': 'DEAL_CARDS', 'awaiting_cut': 'SKIP_CUT'}.get(status, 'FOLD')
                await host.action('room', f'u{actor - 1}', GameAction(
                    match_id=match_id, command_id=uuid4().hex,
                    expected_revision=state['game']['revision'], command=command))
            else:
                raise RuntimeError('Flush fixture did not finish within ten commands.')
            finished = await host.snapshot('room', 'u0')
            locked = await host.table_command('room', 'u0', match_id, 'lock')
            restarted = await host.start('room', 'u0', match_id, 'manual', rules_revision=0)
            states.append(dict(start=start, finished=finished, locked=locked, restarted=restarted))
        output.write_text(json.dumps(states), encoding='utf8')
    finally:
        await host.close()


if __name__ == '__main__':
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.gettempdir()) / 'chat-round-states.json'
    asyncio.run(main(output))
