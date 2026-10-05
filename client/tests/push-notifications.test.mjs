import assert from 'node:assert/strict';
import {test} from 'node:test';
import {notificationTarget} from '../src/notifications/pushTypes.ts';
import {parseQuietTime,formatQuietTime} from '../src/notifications/quietTime.ts';
const data={type:'bhidne_notification',user_id:'user-alice',room_id:'room',match_id:'match'};
test('native notification navigation is bound to the signed-in account',()=>{
  assert.deepEqual(notificationTarget(data,'user-alice'),{roomId:'room',matchId:'match'});
  assert.equal(notificationTarget(data,'user-bob'),null);
  assert.equal(notificationTarget(data,null),null);
  assert.equal(notificationTarget({...data,user_id:null},null),null);
  assert.deepEqual(notificationTarget({...data,match_id:undefined},'user-alice'),{roomId:'room'});
});
test('notification routes reject malformed and unrelated payloads',()=>{
  for(const bad of [null,{},'room',{...data,type:'chat'},{...data,room_id:'https://evil.test'},{...data,match_id:'../secret'},{...data,room_id:'x'.repeat(65)}])
    assert.equal(notificationTarget(bad,'user-alice'),null);
});
test('quiet hour controls parse exact local times and round trip every minute',()=>{
  for(let minute=0;minute<1440;minute++)assert.equal(parseQuietTime(formatQuietTime(minute)),minute);
  for(const bad of ['24:00','22:60','-1:00','1:02','12:2','quiet',''])assert.equal(parseQuietTime(bad),null);
});
