import test from 'node:test';
import assert from 'node:assert/strict';
import { distributedHttpTransport } from '../src/multiplayer/DistributedHttpTransport.ts';
import { DistributedSocketTransport } from '../src/multiplayer/DistributedSocketTransport.ts';
const signal=()=>new AbortController().signal;
function fixture(){
 const sent=[],pages=[];let revoked=0,closed=0;
 const socket={send:s=>sent.push(JSON.parse(s)),close:()=>closed++};
 const t=new DistributedSocketTransport('wss://host/distributed/delivery','token','phone',()=>{},()=>socket);
 const frame=data=>socket.onmessage({data:JSON.stringify(data)});
 const open=(s=signal())=>t.open('lane','phone',p=>pages.push(p),()=>revoked++,s);
 return {t,socket,sent,pages,frame,open,get revoked(){return revoked;},get closed(){return closed;}};
}
test('HTTP maps exact request and actor bearer; errors remain unresolved',async()=>{
 const seen=[];let ok=true;const t=distributedHttpTransport('https://host/distributed/','token',async(url,options)=>{seen.push([url,options]);return {ok,status:503,json:async()=>({status:'pending'})};});
 const body={target:{kind:'room',room_id:'r'},body:{command_id:'same'}};
 await t.submit(body,signal());await t.status({lane_id:'lane',command_id:'a/b'},signal());
 assert.equal(seen[0][1].headers.Authorization,'Bearer token');assert.deepEqual(JSON.parse(seen[0][1].body),body);
 assert.equal(seen[1][0],'https://host/distributed/commands/lane/a%2Fb');ok=false;await assert.rejects(t.submit(body,signal()),/unresolved/);
});
test('multiplexed socket authenticates before subscribing and ACK resolves only on confirmation',async t=>{
 const f=fixture();t.after(()=>f.t.close());const opening=f.open();assert.deepEqual(f.sent,[]);
 f.socket.onopen();assert.equal(f.sent[0].type,'AUTH');f.frame({type:'READY'});const id=f.sent[1].subscription_id;
 f.frame({type:'SUBSCRIBED',subscription_id:id,lane_id:'lane',cursor:3});const s=await opening;
 f.frame({type:'DELIVERY_PAGE',subscription_id:id,lane_id:'lane',after_sequence:3,scanned_sequence:4,events:[]});assert.equal(f.pages.length,1);
 const ack=s.acknowledge(4,signal());f.frame({type:'ACKED',subscription_id:id,scanned_sequence:4,cursor:4});await ack;s.close();assert.equal(f.sent.at(-1).type,'UNSUBSCRIBE');
});
test('abort before handshake removes subscription and ignores late acknowledgment',async t=>{
 const f=fixture();t.after(()=>f.t.close());f.socket.onopen();f.frame({type:'READY'});const a=new AbortController(),p=f.open(a.signal);const id=f.sent.at(-1).subscription_id;
 a.abort();await assert.rejects(p);f.frame({type:'SUBSCRIBED',subscription_id:id,lane_id:'lane',cursor:0});assert.equal(f.revoked,1);
});
test('disconnect rejects pending ACK and revokes local stream',async()=>{
 const f=fixture();f.socket.onopen();f.frame({type:'READY'});const opening=f.open();const id=f.sent.at(-1).subscription_id;
 f.frame({type:'SUBSCRIBED',subscription_id:id,lane_id:'lane',cursor:0});const s=await opening;const ack=s.acknowledge(1,signal());f.socket.onclose();await assert.rejects(ack);assert.equal(f.revoked,1);
});
test('wrong device cannot subscribe; malformed handshake closes connection',async t=>{
 const f=fixture();t.after(()=>f.t.close());await assert.rejects(f.t.open('lane','other',()=>{},()=>{},signal()));
 f.socket.onopen();f.frame({type:'READY'});const p=f.open();const id=f.sent.at(-1).subscription_id;
 f.frame({type:'SUBSCRIBED',subscription_id:id,lane_id:'wrong',cursor:0});await assert.rejects(p);assert.equal(f.closed,1);
});
