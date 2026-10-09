import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryPlayers, summaryScore, summaryTotal } from '../src/multiplayer/callbreakSummary.ts';

const snapshot = {
  players: [1,2,3,4,5].map(player_id => ({player_id})), deal: {dealer:3,deal_number:3},
  game: {score_scale:8},
  deal_history: [
    {deal_number:1,complete:true,players:[{player_id:1,score_tenths:18}]},
    {deal_number:2,complete:true,players:[{player_id:1,score_tenths:-24}]},
    {deal_number:3,complete:false,players:[{player_id:1,score_tenths:100}]},
  ],
};
test('dealer-relative order is viewer-independent; hand summary starts at its lead', () => {
  assert.deepEqual(summaryPlayers(snapshot).map(p=>p.player_id),[4,5,1,2,3]);
  assert.deepEqual(summaryPlayers(snapshot,3,true).map(p=>p.player_id),[3,4,5,1,2]);
  assert.deepEqual(summaryPlayers({...snapshot,deal:undefined}).map(p=>p.player_id),[1,2,3,4,5]);
});
test('completed scores preserve configured units and penalties; incomplete rounds stay empty', () => {
  assert.equal(summaryScore(snapshot,1,1),18);
  assert.equal(summaryScore(snapshot,1,3),null);
  assert.equal(summaryTotal(snapshot,1),-6);
  assert.equal(summaryTotal(snapshot,1,true),null);
  const final={...snapshot,deal_history:[...snapshot.deal_history,{deal_number:5,complete:true,players:[{player_id:1,score_tenths:32}]}]};
  assert.equal(summaryTotal(final,1),-6);
  assert.equal(summaryTotal(final,1,true),26);
  assert.equal(summaryTotal({...snapshot,game:{finished:true},scoreboard:[{player_id:1,total_score_tenths:32}]},1,true),32);
});
