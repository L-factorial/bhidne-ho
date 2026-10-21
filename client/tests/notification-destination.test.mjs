import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pushDestination,recipientMatches,isNotificationActivity} from '../src/notifications/notificationDestination.ts';
const base={type:'bhidne_notification',user_id:'user-me',room_id:'room',match_id:'match'};
test('every game action preserves its exact destination without authorizing an action',()=>{
 for(const kind of ['ready','bid','play','shuffle','cut','deal','review','declare','draw','discard','finish','bet','side_show']){
  const target=pushDestination({...base,kind},'event');
  assert.equal(target.roomId,'room');assert.equal(target.matchId,'match');assert.equal(target.notificationKind,kind);
  assert.equal(isNotificationActivity(target),true);assert.equal(recipientMatches(target,'user-me'),true);
  assert.equal(recipientMatches(target,null),false);assert.equal(recipientMatches(target,'user-other'),false);
 }
});
test('invitations retain explicit confirmation and chat retains scope',()=>{
 for(const kind of ['room_invitation','game_invitation'])assert.equal(isNotificationActivity(pushDestination({...base,kind},'event')),false);
 for(const scope of ['room','table','game']){
  const target=pushDestination({...base,kind:'chat',scope,match_id:scope==='room'?undefined:'match'},'event');
  assert.equal(target.scope,scope);
 }
 assert.equal(pushDestination({...base,kind:'chat'},'legacy').scope,'table');
});
test('direct chat and friendship route without any room, retaining recipient through sign-in',()=>{
 for(const kind of ['chat','friend_request','friend_requested','friend_accepted','friend_rejected']){
  const target=pushDestination({...base,kind,room_id:'',match_id:undefined,other_user_id:'user-00000000-0000-0000-0000-000000000001'},'event');
  assert.equal(target.otherUserId,'user-00000000-0000-0000-0000-000000000001');assert.equal(target.recipientId,'user-me');
 }
});
test('reject unknown, malformed and incomplete routes',()=>{
 for(const value of [null,{}, {...base,kind:'unknown'}, {...base,kind:'play',match_id:undefined}, {...base,kind:'chat',scope:'evil'}, {...base,kind:'chat',scope:'game',match_id:undefined}, {...base,kind:'chat',scope:'room'}, {...base,kind:'chat',room_id:'https://evil'}, {...base,kind:'chat',match_id:'../secret'}, {...base,kind:'chat',room_id:'',match_id:undefined,other_user_id:'bad'}])assert.equal(pushDestination(value,'event'),null);
});

test('game chat preserves the durable game identity and rejects malformed identities',()=>{
 const game_id='00000000-0000-0000-0000-000000000001';
 assert.equal(pushDestination({...base,kind:'chat',scope:'game',game_id},'event').gameId,game_id);
 assert.equal(pushDestination({...base,kind:'chat',scope:'game',game_id:'../wrong'},'event'),null);
});
