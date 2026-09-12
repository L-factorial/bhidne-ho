import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundGuidance } from '../src/multiplayer/roundFlow.ts';
const state = phase => ({your_player_id: 1, players: [{player_id: 2, display_name: 'Asha'}], game: {phase, turn: {player_id: 2}, current_trick: null}});
test('phase guidance identifies the actor and all steps', () => {
  for (const [phase, step] of ['AWAITING_SHUFFLE','AWAITING_CUT','AWAITING_DISTRIBUTION','BIDDING','PLAYING'].map((p,i)=>[p,i])) {
    const guide = roundGuidance(state(phase));
    assert.equal(guide.step, step); assert.equal(guide.mine, false); assert.match(guide.title, /Asha/);
  }
  assert.equal(roundGuidance(state('DEAL_COMPLETE')).step, 5);
  assert.equal(roundGuidance(state('MATCH_COMPLETE')).step, 5);
});
test('play guidance distinguishes leading, following suit, and review', () => {
  const s = state('PLAYING'); s.your_player_id = 2;
  assert.match(roundGuidance(s).instruction, /lead/);
  s.game.current_trick = {plays:[{card:'QC'}]};
  assert.match(roundGuidance(s).instruction, /Follow clubs/);
  const review = {...state('HAND_REVIEW'), private:{can_accept_hand:true}};
  assert.equal(roundGuidance(review).mine, true);
  review.private.can_accept_hand = false;
  assert.equal(roundGuidance(review).mine, false);
});
