"""Generate isolated, legally played snapshots for client/tests/browser/game-stats.cjs.

Run from the repository root with .venv/bin/python tests/browser_game_stats_fixtures.py.
No production services, identities, tables, or messages are accessed.
"""
import asyncio,json,sys,os
from pathlib import Path
sys.path.insert(0,str(Path.cwd()));sys.path.insert(0,str(Path.cwd()/'tests'))
from test_hosted_checkpoints import make_host,start,action,engine_state
from callbreak import GameQuery
out=Path(os.environ.get('FIXTURE_DIR', '/private/tmp/bhidne-stats-fixtures'));out.mkdir(parents=True,exist_ok=True)
async def main():
 for kind,count in [('callbreak',4),('callbreak',5),('marriage',4),('flush',4)]:
  host,game=await make_host(kind,count)
  try:
   await start(host,game)
   if kind=='callbreak':
    # Legal complete rounds via the host's usual actions/controllers.
    while len(game.state.completed_deals)<2 or game.state.phase.value!='PLAYING' or len(game.state.current_deal.completed_tricks)<3:
     s=game.state;phase=s.phase.value
     if phase=='AWAITING_SHUFFLE':await action(host,game,'SHUFFLE_DECK')
     elif phase=='AWAITING_CUT':await action(host,game,'SKIP_CUT')
     elif phase=='AWAITING_DISTRIBUTION':await action(host,game,'START_DISTRIBUTION')
     elif phase=='DISTRIBUTING':host._apply_controllers(game)
     elif phase=='HAND_REVIEW':
      seat=next(p for p in s.config.players if p not in s.current_deal.accepted_hands)
      await action(host,game,'ACCEPT_HAND',user=game.users[seat-1])
     elif phase=='BIDDING':await action(host,game,'PLACE_BID',{'amount':2})
     elif phase=='PLAYING':await action(host,game,'PLAY_CARD',{'card':GameQuery(s).get_player_view(s.current_player)['legal_cards'][0]})
     elif phase=='DEAL_COMPLETE':host._apply_controllers(game,advance_deal=True)
     else:raise RuntimeError(phase)
    # Leave several publicly played cards in the current trick.
    for _ in range(count-1):
     s=game.state;await action(host,game,'PLAY_CARD',{'card':GameQuery(s).get_player_view(s.current_player)['legal_cards'][0]})
   elif kind=='flush':
    await action(host,game,'DEAL_CARDS');await action(host,game,'SKIP_CUT')
    for _ in range(8):
     s=engine_state(game)
     if s.players[s.current_seat].visibility.value=='blind':await action(host,game,'SEE_CARDS')
     await action(host,game,'BET',{'amount':20})
   snap=await host.snapshot('room','u0')
   for p in snap['players']:p['display_name']='Player '+str(p['player_id']);p['connected']=True
   if kind=='flush':
    for p in snap['flush']['participants']:p['display_name']='Player '+p['player_id']
   out.joinpath(f'{kind}-{count}.json').write_text(json.dumps(snap))
  finally:await host.close()
if __name__ == '__main__':
 asyncio.run(main())
