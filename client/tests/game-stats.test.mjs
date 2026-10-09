import test from 'node:test';
import assert from 'node:assert/strict';
import { callBreakPreviousStats, callBreakTrickHistory, flushStatsHistory } from '../src/multiplayer/gameStats.ts';
import { callBreakSeatGeometry, inwardTrickPosition } from '../src/multiplayer/callbreakLayout.ts';
import { initialHandDrawer, updateHandDrawer } from '../src/multiplayer/handDrawer.ts';

test('Call Break separates prior-round bids/bonus from current bids and merges trick history without duplication', () => {
  const trick = {trick_number:1,complete:true,winner:2,plays:[{player_id:1,card:'AS'},{player_id:2,card:'2S'}]};
  const snapshot={deal:{deal_number:3,tricks:[trick]},deal_history:[
    {deal_number:1,complete:true,players:[{player_id:1,bid:3,tricks_won:5}],tricks:[trick]},
    {deal_number:2,complete:true,players:[{player_id:1,bid:4,tricks_won:2}],tricks:[trick]},
    {deal_number:3,complete:false,players:[{player_id:1,bid:8,tricks_won:1}],tricks:[trick]},
  ]};
  assert.deepEqual(callBreakPreviousStats(snapshot,1),{bids:7,bonus:2});
  assert.deepEqual(callBreakPreviousStats(snapshot,2),{bids:0,bonus:0});
  assert.deepEqual(callBreakTrickHistory(snapshot,null).map(t=>t.round),[1,2,3]);
  assert.equal(callBreakTrickHistory(snapshot,'2').length,3);
  assert.equal(callBreakTrickHistory(snapshot,'5').length,0);
});

test('Flush individual history includes both sides of a side show and historical winners', () => {
  const history=[{sequence:1,player_id:'1',target_player_id:null,loser_player_id:null,winner_ids:[]},
    {sequence:2,player_id:'2',target_player_id:'1',loser_player_id:'1',winner_ids:[]},
    {sequence:3,player_id:null,target_player_id:null,loser_player_id:null,winner_ids:['1']},
    {sequence:4,player_id:'3',target_player_id:null,loser_player_id:null,winner_ids:[]}];
  const snapshot={flush:{history}};
  assert.deepEqual(flushStatsHistory(snapshot,'1').map(event=>event.sequence),[1,2,3]);
  assert.equal(flushStatsHistory(snapshot,null).length,4);
  assert.deepEqual(flushStatsHistory({},null),[]);
});

test('stats keeps cards collapsed across turns, failures and new deals while consuming attention transitions', () => {
  const input={deal:'match:1',turn:'first',revision:3,hand:['AS','KH'],busy:false,error:''};
  let state=updateHandDrawer(initialHandDrawer,input);
  assert.equal(state.open,true);
  state=updateHandDrawer({...state,pending:{card:'AS',revision:3}},{...input,keepCollapsed:true,error:'Rejected'});
  assert.equal(state.open,false);assert.equal(state.pending,null);
  state=updateHandDrawer(state,{...input,turn:'next',revision:4,keepCollapsed:true});
  assert.equal(state.open,false);assert.equal(state.entered,'next');
  assert.equal(updateHandDrawer(state,{...input,turn:'next',revision:4}).open,false);
  state=updateHandDrawer(state,{...input,deal:'match:2',turn:'new-deal',keepCollapsed:true});
  assert.equal(state.open,false);
  assert.equal(updateHandDrawer(state,{...input,deal:'match:2',turn:'new-deal'}).open,false);
});

const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
test('Call Break inward cards and two-row seats do not overlap at narrow widths or larger text sizes', () => {
  for(const width of [240,256,280,336,390,760])for(const scale of [1,1.5,2])for(const count of [2,3,4,5]){
    const layout=callBreakSeatGeometry(count,width,scale);
    const seats=layout.positions.map(p=>({x:p.x-layout.seatWidth/2,y:p.y-layout.seatHeight/2,width:layout.seatWidth,height:layout.seatHeight}));
    const cards=layout.positions.map((_,index)=>{const p=inwardTrickPosition(layout,index);return{x:p.x-20,y:p.y-28,width:40,height:56};});
    const center={x:layout.center.x-64,y:layout.center.y-32,width:128,height:64};
    for(const [index,card] of cards.entries()){
      assert.ok(card.x>=0&&card.x+card.width<=width&&card.y>=0&&card.y+card.height<=layout.height);
      assert.ok(!overlaps(card,center),`center/card overlap ${count}/${width}/${scale}`);
      assert.ok(seats.every(seat=>!overlaps(card,seat)),`seat/card overlap ${count}/${width}/${scale}`);
      assert.ok(cards.slice(index+1).every(other=>!overlaps(card,other)),`cards overlap ${count}/${width}/${scale}`);
    }
    for(const [index,seat] of seats.entries())assert.ok(seats.slice(index+1).every(other=>!overlaps(seat,other)));
  }
});
