import test from 'node:test';
import assert from 'node:assert/strict';
import { canConfigureGameRules } from '../src/multiplayer/gameRulesConfig.ts';

test('rule configuration requires the creator and a pregame or completed game', () => {
  const open = {is_creator:true,status:'waiting',table:{phase:'OPEN'}};
  assert.equal(canConfigureGameRules(open), true);
  assert.equal(canConfigureGameRules({...open,table:undefined}), true);
  for (const phase of ['STARTED','ENDED']) assert.equal(canConfigureGameRules({...open,table:{phase}}), false);
  for (const status of ['playing','ended']) assert.equal(canConfigureGameRules({...open,status}), false);
  assert.equal(canConfigureGameRules({...open,status:'finished',table:{phase:'COMPLETED'}}), true);
  assert.equal(canConfigureGameRules({...open,table:{phase:'LOCKED'}}), true);
  assert.equal(canConfigureGameRules({...open,status:'playing',flush:{public:{status:'finished'}}}), true);
  assert.equal(canConfigureGameRules({...open,is_creator:false}), false);
  assert.equal(canConfigureGameRules({...open,flush_settings:{locked:true}}), false);
  assert.equal(canConfigureGameRules({...open,rule_proposal:{status:'PENDING'}}), true);
  assert.equal(canConfigureGameRules({...open,rule_proposal:{status:'ACCEPTED'}}), true);
});
