import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesNotification} from '../src/multiplayer/notificationActions.ts';
const row=(id,scope,room_id,match_id,actor='a')=>({id,kind:'chat',read:false,actor:{user_id:actor},payload:{scope,room_id,match_id}});
test('direct actions only acknowledge unread messages from the selected participant',()=>{
 const action={kind:'direct',otherUserId:'a'};
 assert.equal(matchesNotification(row('1','direct'),action),true);
 assert.equal(matchesNotification(row('2','direct',undefined,undefined,'b'),action),false);
 assert.equal(matchesNotification(row('3','table','r','m'),action),false);
 assert.equal(matchesNotification({...row('4','direct'),read:true},action),false);
});
test('table and room actions preserve other tables and conversation scopes',()=>{
 const rows=[row('1','table','r','m'),row('2','table','r','other'),row('3','room','r'),row('4','table','other','m'),row('5','direct')];
 assert.deepEqual(rows.filter(r=>matchesNotification(r,{kind:'table',roomId:'r',matchId:'m'})).map(r=>r.id),['1']);
 assert.deepEqual(rows.filter(r=>matchesNotification(r,{kind:'room',roomId:'r'})).map(r=>r.id),['3']);
 assert.equal(matchesNotification({...rows[0],kind:'poke'},{kind:'table',roomId:'r',matchId:'m'}),true);
});
test('friend actions preserve chat and unrelated social notifications',()=>{
 const action={kind:'friend',otherUserId:'a'};
 assert.equal(matchesNotification({...row('1','direct'),kind:'friend_accepted'},action),true);
 assert.equal(matchesNotification(row('2','direct'),action),false);
 assert.equal(matchesNotification({...row('3','direct',undefined,undefined,'b'),kind:'friend_rejected'},action),false);
});
