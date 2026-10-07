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

const {registerIosDevice,PushSetupError}=await import('../src/notifications/nativeRegistration.ts');
function native(overrides={}){
 const sent=[];
 return {sent,api:{token:async()=> 'a'.repeat(64),environment:async()=>null,isStoreBuild:async()=>true,
  active:()=>true,register:async(...args)=>{sent.push(args);},...overrides}};
}
test('TestFlight registers a real APNs token in production when the embedded profile is absent',async()=>{
 const f=native();await registerIosDevice(f.api);assert.deepEqual(f.sent,[['a'.repeat(64),'production']]);
});
test('an explicit sandbox environment stays sandbox and never needs a store fallback',async()=>{
 const f=native({environment:async()=> 'development',isStoreBuild:async()=>assert.fail()});
 await registerIosDevice(f.api);assert.equal(f.sent[0][1],'development');
});
test('missing environment fails closed outside identified store builds',async()=>{
 const f=native({isStoreBuild:async()=>false});
 await assert.rejects(registerIosDevice(f.api),{code:'PUSH_BUILD_REQUIRED'});assert.equal(f.sent.length,0);
});
test('token and environment failures have specific errors and never submit registration',async()=>{
 for(const [overrides,code] of [[{token:async()=>{throw Error('native failure');}},'PUSH_TOKEN_FAILED'],
  [{token:async()=> 'ExpoPushToken[invalid]'},'PUSH_TOKEN_FAILED'],
  [{environment:async()=>{throw Error('native failure');}},'PUSH_ENVIRONMENT_FAILED'],
  [{isStoreBuild:async()=>{throw Error('native failure');}},'PUSH_ENVIRONMENT_FAILED']]){
  const f=native(overrides);await assert.rejects(registerIosDevice(f.api),{code});assert.equal(f.sent.length,0);
 }
});
test('account change or cancellation during native setup prevents registration',async()=>{
 for(const stage of ['token','environment','isStoreBuild']){
  let active=true;const f=native({active:()=>active});const original=f.api[stage];
  f.api[stage]=async()=>{const value=await original();active=false;return value;};
  await registerIosDevice(f.api);assert.equal(f.sent.length,0);
 }
});
test('registration validation errors are specific while authentication and uncertain network errors survive',async()=>{
 for(const status of [401,422,503]){
  const failure=Object.assign(Error('server failure'),{status});const f=native({register:async()=>{throw failure;}});
  await assert.rejects(registerIosDevice(f.api),error=>status===422?error instanceof PushSetupError&&error.code==='PUSH_REGISTRATION_FAILED':error===failure);
 }
});
