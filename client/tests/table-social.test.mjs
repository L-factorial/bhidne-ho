import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSocialChannel, mergeTableMessages } from '../src/multiplayer/TableSocialChannel.ts';
import { RoomConnection } from '../src/multiplayer/RoomConnection.ts';

test('social commands retry the same ID and acknowledge separately from game actions', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const channel = new TableSocialChannel(), sent = [], controller = new AbortController();
  channel.send = value => {sent.push(value);return true;};
  const result = channel.request('TABLE_CHAT_SEND','table',{text:'Hello'},controller.signal);
  t.mock.timers.tick(4000);
  assert.equal(sent.length,2); assert.deepEqual(sent[0],sent[1]);
  channel.receive({type:'TABLE_SOCIAL_ACK',match_id:'other',command_id:sent[0].command_id,status:'accepted'});
  channel.receive({type:'TABLE_SOCIAL_ACK',match_id:'table',command_id:sent[0].command_id,status:'accepted'});
  assert.equal((await result).status,'accepted');
  t.mock.timers.tick(20000); assert.equal(sent.length,2);
});
test('rejections and leaving a table stop retries', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const channel = new TableSocialChannel(), sent = [], controller = new AbortController();
  channel.send = value => {sent.push(value);return true;};
  const result = channel.request('TABLE_POKE_SEND','table',{recipient_player_id:2},controller.signal);
  channel.receive({type:'TABLE_SOCIAL_ACK',match_id:'table',command_id:sent[0].command_id,status:'rejected',detail:'Offline'});
  await assert.rejects(result,/Offline/);
  const pending = channel.request('TABLE_CHAT_HISTORY','table',{},controller.signal);
  controller.abort(); await assert.rejects(pending,/cancelled/);
  t.mock.timers.tick(20000); assert.equal(sent.length,2);
});
test('history merges with live messages without duplicates and remains bounded', () => {
  const message = (id, sent_at) => ({id,sent_at,text:id});
  assert.deepEqual(mergeTableMessages([message('b',2)],[message('a',1),message('b',2)]).map(m=>m.id),['a','b']);
  assert.equal(mergeTableMessages([],Array.from({length:150},(_,i)=>message(String(i),i))).length,100);
});
test('room connection permits sending only after authenticated CONNECTED', () => {
  const socket = {send(value){this.last=JSON.parse(value);},close(){},onmessage:null,onclose:null,onerror:null};
  const connection = new RoomConnection('ws://room',()=>{},()=>socket);
  connection.start();
  try {
    assert.equal(connection.send({type:'TABLE_CHAT_HISTORY'}),false);
    socket.onmessage({data:'{"type":"CONNECTED"}'});
    assert.equal(connection.send({type:'TABLE_CHAT_HISTORY'}),true);
    assert.equal(socket.last.type,'TABLE_CHAT_HISTORY');
    connection.stop(); assert.equal(connection.send({type:'TABLE_CHAT_HISTORY'}),false);
  } finally {connection.stop();}
});
