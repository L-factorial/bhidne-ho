import test from 'node:test';
import assert from 'node:assert/strict';
import {signupUsernameRules,validSignupUsername,validSignupPassword} from '../src/auth/signupValidation.ts';

test('signup accepts only 3–32 ASCII letters/digits beginning with a letter',()=>{
 for(const name of ['abc','Alice2026','A'+'1'.repeat(31)])assert.equal(validSignupUsername(name),true,name);
 for(const name of ['','ab','A'.repeat(33),'1alice','_alice','al_ice','al-ice','alice!','alice smith',' alice','alice ','अजय'])assert.equal(validSignupUsername(name),false,name);
 assert.deepEqual(signupUsernameRules('2alice'),[true,true,false]);
 assert.deepEqual(signupUsernameRules('a_'),[false,false,true]);
});
test('password guidance and form gating match the server character-count limits',()=>{
 for(const value of ['12345678','a'.repeat(128),'🔑'.repeat(8),' space & symbols! '])assert.equal(validSignupPassword(value),true);
 for(const value of ['','a'.repeat(7),'a'.repeat(129),'🔑'.repeat(7)])assert.equal(validSignupPassword(value),false);
});
