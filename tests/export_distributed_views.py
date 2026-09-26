"""Generate authorized game projections for the opt-in mounted browser smoke."""
import asyncio
import json
from pathlib import Path
import sys
from uuid import UUID
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_checkpoint_store import host_game


async def main(directory):
    directory.mkdir(parents=True,exist_ok=True)
    users=[f'user-{UUID(int=n)}' for n in range(1,7)]
    for kind in ('callbreak','marriage','flush'):
        host,game=await host_game(users,kind)
        try:
            # Observe the current actor so mounted action buttons are meaningful.
            value=host._snapshot(game,users[0])
            value.update(room_id='a'*32,table_id=game.table.table_id,table_revision=3,durable_game_id=str(game.durable_game_id))
            (directory/(kind+'.json')).write_text(json.dumps(value))
        finally:await host.close()


if __name__=='__main__':asyncio.run(main(Path(sys.argv[1])))
