import test from 'node:test';
import assert from 'node:assert/strict';
import { configureAuthStorage } from '../src/auth/storage.ts';
import { readSession, saveSession, signOutSession, isCurrentSession, retrySessionStorage } from '../src/multiplayer/session.ts';
import { sessionNotice } from '../src/auth/sessionNotice.ts';
const a = {session:{user_id:'alice',token:'alice-token'},room:null,game:null};
const b = {session:{user_id:'bob',token:'bob-token'},room:null,game:null};
function adapter() {
  const data = new Map();
  const storage = {read:key=>data.get(key) ?? null,write:(key,value)=>{if(value===null)data.delete(key);else data.set(key,value);}};
  configureAuthStorage(storage); return {data,storage};
}
test('restores the existing saved-session format while discarding cached private room data',()=>{
  const {data}=adapter();
  data.set('bhidne.session.v1:restart',JSON.stringify({...a,room:{room_id:'room1',name:'Room',members:['private'],member_previews:[{display_name:'private'}]}}));
  assert.deepEqual(readSession('restart'),{...a,room:{room_id:'room1',name:'Room',members:[]}});
});
test('storage failures cannot restore an old account or undo local logout',()=>{
  const {storage}=adapter();saveSession('failed-write',a);
  storage.write=()=>{throw Error('locked');};
  assert.equal(saveSession('failed-write',b),false);
  assert.deepEqual(readSession('failed-write'),b);
  assert.equal(sessionNotice('failed-write'),'storage_save_failed');
  saveSession('failed-write',null);
  assert.equal(readSession('failed-write'),null);
  assert.equal(sessionNotice('failed-write'),'storage_clear_failed');
});
test('cold-start read failure is safe and visible; a later login can persist',()=>{
  const {storage}=adapter();storage.read=()=>{throw Error('locked');};
  assert.equal(readSession('locked-start'),null);
  assert.equal(sessionNotice('locked-start'),'storage_read_failed');
  assert.equal(saveSession('locked-start',a),true);
  assert.equal(sessionNotice('locked-start'),'');
  assert.equal(isCurrentSession('locked-start',a.session),true);
});
test('online logout clears storage before waiting for server revocation',async()=>{
  const {data}=adapter();saveSession('online',a);let finish;
  const pending=signOutSession('online',a.session,session=>{assert.deepEqual(session,a.session);return new Promise(resolve=>{finish=resolve;});});
  assert.equal(readSession('online'),null);assert.equal(data.has('bhidne.session.v1:online'),false);
  finish();await pending;assert.equal(sessionNotice('online'),'');
});
test('offline logout and already-expired logout have distinct outcomes',async()=>{
  adapter();saveSession('offline',a);
  await signOutSession('offline',a.session,async()=>{throw Error('offline');});
  assert.equal(readSession('offline'),null);assert.equal(sessionNotice('offline'),'signed_out_local');
  saveSession('expired',a);await signOutSession('expired',a.session,async()=>{throw {status:401};});
  assert.equal(sessionNotice('expired'),'');
});
test('late logout failure cannot overwrite a new account or sign it out',async()=>{
  adapter();saveSession('switch',a);let fail;
  const pending=signOutSession('switch',a.session,()=>new Promise((_,reject)=>{fail=reject;}));
  saveSession('switch',b);fail(Error('offline'));await pending;
  await signOutSession('switch',a.session,()=>assert.fail('stale token must not affect new account'));
  assert.deepEqual(readSession('switch'),b);assert.equal(sessionNotice('switch'),'');
});
test('malformed stored sessions do not authenticate',()=>{
  const {data}=adapter();for(const [i,value] of ['null','{}','broken','{"session":{"token":"","user_id":"a"}}'].entries()) {
    data.set(`bhidne.session.v1:bad-${i}`,value);assert.equal(readSession(`bad-${i}`),null);
  }
});

test('retry persists the latest logout choice once storage is writable again',()=>{
  const {storage,data}=adapter();saveSession('retry',a);const write=storage.write;
  storage.write=()=>{throw Error('locked');};saveSession('retry',null);
  storage.write=write;assert.equal(retrySessionStorage('retry'),true);
  assert.equal(data.has('bhidne.session.v1:retry'),false);assert.equal(sessionNotice('retry'),'');
});
