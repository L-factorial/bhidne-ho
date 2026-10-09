import test from 'node:test';
import assert from 'node:assert/strict';
import { canConfigureGameRules } from '../src/multiplayer/gameRulesConfig.ts';

test('rule configuration requires the creator and an unlocked waiting game without a pending proposal', () => {
  const open = {is_creator:true,status:'waiting',table:{phase:'OPEN'}};
  assert.equal(canConfigureGameRules(open), true);
  assert.equal(canConfigureGameRules({...open,table:undefined}), true);
  for (const phase of ['LOCKED','STARTED','COMPLETED','ENDED']) assert.equal(canConfigureGameRules({...open,table:{phase}}), false);
  for (const status of ['playing','finished','ended']) assert.equal(canConfigureGameRules({...open,status}), false);
  assert.equal(canConfigureGameRules({...open,is_creator:false}), false);
  assert.equal(canConfigureGameRules({...open,flush_settings:{locked:true}}), false);
  assert.equal(canConfigureGameRules({...open,rule_proposal:{status:'PENDING'}}), false);
  assert.equal(canConfigureGameRules({...open,rule_proposal:{status:'ACCEPTED'}}), true);
});
