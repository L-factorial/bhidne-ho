import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionTime, remaining, ownAction, observeServerClock, sessionNow, sessionCountdown} from '../src/multiplayer/tableSession.ts';
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

test('table countdown prioritizes own human action, skips auto seats and preserves idle deadlines', () => {
  const session = { idle_deadline: null, expired_at: null, removal_reason: null,
    controls: [{ seat_id: 1, user_id: 'auto', mode: 'auto' }, { seat_id: 2, user_id: 'other', mode: 'manual' }, { seat_id: 3, user_id: 'me', mode: 'manual' }],
    required_actions: [{ seat_id: 1, user_id: 'auto', deadline: 110 }, { seat_id: 2, user_id: 'other', deadline: 140 }, { seat_id: 3, user_id: 'me', deadline: 260 }] };
  assert.deepEqual(sessionCountdown(session, 'me', 100), { time: '2:40', idle: false, seatId: 3, warning: false, waiting: false });
  assert.equal(sessionCountdown(session, 'spectator', 100).seatId, 2);
  assert.equal(sessionCountdown(session, 'auto', 100).seatId, 2);
  assert.equal(sessionCountdown(session, 'me', 229).warning, false);
  assert.equal(sessionCountdown(session, 'me', 230).warning, true);
  session.idle_deadline = 1900;
  assert.equal(sessionCountdown(session, 'me', 100).time, '30:00');
  assert.equal(sessionCountdown(session, 'me', 100).idle, true);
});

test('table countdown reaches zero without removing a seat and disappears only after authoritative expiry', () => {
  const session = { idle_deadline: null, expired_at: null, removal_reason: null, controls: [],
    required_actions: [{ seat_id: 1, user_id: 'me', deadline: 120 }] };
  assert.equal(sessionCountdown(session, 'me', 120).time, '0:00');
  assert.equal(sessionCountdown(session, 'me', 120).waiting, true);
  assert.equal(sessionCountdown(session, 'me', 135).time, '0:00');
  assert.equal(session.required_actions.length, 1);
  for (const hidden of [undefined, { ...session, required_actions: [] }, { ...session, expired_at: 130 }, { ...session, removal_reason: 'ACTION_TIMEOUT' }]) {
    assert.equal(sessionCountdown(hidden, 'me', 135), null);
  }
});
