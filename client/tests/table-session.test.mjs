import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionTime, remaining, ownAction, observeServerClock, sessionNow} from '../src/multiplayer/tableSession.ts';
import {gameAttention} from '../src/notifications/gameAttention.ts';

test('countdown clamps elapsed deadlines and accommodates device clock skew',()=>{
  assert.equal(remaining(280,100),180);
  assert.equal(remaining(280,300),0);
  assert.equal(sessionTime(180),'3:00');
  assert.equal(sessionTime(1800),'30:00');
  const original=Date.now;
  Date.now=()=>100000;
  try{
    observeServerClock('200050',100000,100100);
    assert.equal(sessionNow(),200);
    observeServerClock(null,100000,100100);
    assert.equal(sessionNow(),200);
  }finally{Date.now=original;observeServerClock(String(Date.now()),Date.now(),Date.now());}
});

test('autoplay ownership requires explicit resume and suppresses human action notifications',()=>{
  const session={controls:[{seat_id:1,user_id:'me',mode:'auto'}],required_actions:[{seat_id:1,user_id:'me',deadline:100}]};
  assert.equal(ownAction(session,'me'),null);
  assert.equal(gameAttention({match_id:'match',status:'playing',game_type:'callbreak',your_player_id:1,session,
    game:{phase:'PLAYING',turn:{player_id:1}}}),null);
  session.controls[0].mode='manual';
  assert.equal(ownAction(session,'me').seat_id,1);
  assert.equal(gameAttention({match_id:'match',status:'playing',game_type:'callbreak',your_player_id:1,session,
    game:{phase:'PLAYING',turn:{player_id:1}}}).required,true);
});
