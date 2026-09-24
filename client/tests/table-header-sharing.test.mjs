import test from 'node:test';
import assert from 'node:assert/strict';
import { showTableHeaderShare } from '../src/multiplayer/tableHeaderSharing.ts';
const base = {room_id:'room',match_id:'match',status:'playing',your_player_id:1};
test('header sharing follows live role and round transitions for every game',()=>{
  for(const game_type of ['marriage','callbreak','flush']) {
    const snapshot={...base,game_type};
    assert.equal(showTableHeaderShare(snapshot),false);
    assert.equal(showTableHeaderShare({...snapshot,your_player_id:null}),true);
    assert.equal(showTableHeaderShare({...snapshot,table:{phase:'STARTED',current_user:{is_seated:false,is_queued:true}}}),true);
    assert.equal(showTableHeaderShare({...snapshot,status:'waiting'}),true);
    assert.equal(showTableHeaderShare({...snapshot,status:'finished'}),true);
    assert.equal(showTableHeaderShare({...snapshot,status:'ended',your_player_id:null}),false);
  }
});
test('Flush round completion restores the shortcut without ending its table',()=>{
  assert.equal(showTableHeaderShare({...base,game_type:'flush',flush:{public:{status:'finished'}}}),true);
  assert.equal(showTableHeaderShare({...base,game_type:'flush',flush:{public:{status:'betting'}}}),false);
});
