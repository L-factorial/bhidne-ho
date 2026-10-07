import test from 'node:test';
import assert from 'node:assert/strict';
import {playFeed,playEntry} from '../src/multiplayer/playFeed.ts';
const table=(match_id,created_at=0,extra={})=>({room_id:'r',room_name:'Room',match_id,name:match_id,game_type:'flush',status:'waiting',players:1,capacity:2,created_at,current_user:{can_join:true},...extra});
const invitation=(match_id,created_at)=>({id:'invite-'+match_id,room_id:'r',room_name:'Room',match_id,table_name:match_id,game_type:'flush',created_at,seated:1,capacity:2,seat_available:true});
test('Play merges invitations without duplicating tables and sorts by newest activity',()=>{
 const result=playFeed([table('old',1),table('current',5,{players:2})],[invitation('current',8),invitation('new',10)]);
 assert.deepEqual(result.map(t=>t.match_id),['new','current','old']);
 assert.equal(result[1].players,2);assert.equal(result[1].invitation_id,'invite-current');
 assert.equal(playEntry(result[1]),'watch');assert.equal(playEntry(result[0]),'seat');
});
test('Join respects authoritative permission, full tables and existing seats',()=>{
 assert.equal(playEntry(table('a')),'seat');
 assert.equal(playEntry(table('a',0,{players:2})),'watch');
 assert.equal(playEntry(table('a',0,{current_user:{can_join:false}})),'watch');
 assert.equal(playEntry(table('a',0,{current_user:{is_seated:true,can_join:true}})),'watch');
 assert.equal(playEntry(table('a',0,{current_user:undefined})),'watch');
});
