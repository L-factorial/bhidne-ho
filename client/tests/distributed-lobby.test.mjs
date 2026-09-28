import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedReadClient } from '../src/multiplayer/DistributedReadClient.ts';
const signal = () => new AbortController().signal;
const room = (room_id, feed_source, created_at=0) => ({room_id,feed_source,created_at,name:room_id,members:[]});
function reader(pages, calls=[]) {
 return new DistributedReadClient('https://host/distributed','token',async(url, options)=>{
  calls.push(url); assert.equal(options.headers.Authorization,'Bearer token');
  return {ok:true,json:async()=>pages.shift()};
 });
}
test('lobby loads all pages before applying original source and recency ordering',async()=>{
 const calls=[];
 const r=reader([{items:[room('a','public'),room('b','friend')],next_room_id:'b'},
  {items:[room('c','you',1),room('d','joined'),room('e','you',2)],next_room_id:null}],calls);
 assert.deepEqual((await r.lobby(signal())).map(r=>r.room_id),['e','c','d','b','a']);
 assert.ok(calls[1].endsWith('&after_room_id=b'));
});
test('a broken cursor or duplicate page cannot silently truncate the lobby',async()=>{
 await assert.rejects(reader([{items:[room('a','you')],next_room_id:'wrong'}]).lobby(signal()),/cursor/);
 await assert.rejects(reader([{items:[room('a','you')],next_room_id:'a'},
  {items:[room('a','you')],next_room_id:null}]).lobby(signal()),/Repeated/);
});
test('aborted lobby cannot publish a late successful response',async()=>{
 const abort=new AbortController();
 const r=new DistributedReadClient('https://host/distributed','token',async()=>{
  abort.abort();return {ok:true,json:async()=>({items:[],next_room_id:null})};
 });
 await assert.rejects(r.lobby(abort.signal),/aborted/);
});
test('activity advances across empty room pages without inventing tables',async()=>{
 const calls=[];
 const r=reader([{items:[],next_room_id:'room-a'},{items:[{match_id:'match'}],next_room_id:null}],calls);
 assert.deepEqual(await r.activity('active-tables',signal()),[{match_id:'match'}]);
 assert.ok(calls[1].endsWith('?after_room_id=room-a'));
 await assert.rejects(reader([{items:[],next_room_id:'a'},{items:[],next_room_id:'a'}]).activity('memberships',signal()),/cursor/);
});
test('member profiles preserve server identities and reject incomplete/repeated paging',async()=>{
 const a={user_id:'user-a',display_name:'Alice',username:'alice'},b={user_id:'user-b',display_name:'Bob',username:null};
 const r=reader([{items:[a],next_user_id:'user-a'},{items:[b],next_user_id:null}]);
 assert.deepEqual(await r.memberProfiles('room',signal()),[a,b]);
 await assert.rejects(reader([{items:[a],next_user_id:'wrong'}]).memberProfiles('room',signal()),/cursor/);
});
