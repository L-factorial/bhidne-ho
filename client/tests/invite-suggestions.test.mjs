import test from 'node:test';
import assert from 'node:assert/strict';
import {inviteSuggestions} from '../src/multiplayer/inviteSuggestions.ts';
const player=(user_id,display_name,username)=>({user_id,display_name,username});
const sigma=player('user-sigma','Sigma','sigma');
test('suggestions require three trimmed characters and match names, usernames and IDs',()=>{
 assert.deepEqual(inviteSuggestions([sigma],'si','self'),[]);
 assert.deepEqual(inviteSuggestions([sigma],' SIG ','self'),[sigma]);
 assert.deepEqual(inviteSuggestions([sigma],'user-sig','self'),[sigma]);
});
test('suggestions exclude self and invitees, deduplicate and prioritize exact username',()=>{
 const another=player('other','A Sigma','sigma2');
 assert.deepEqual(inviteSuggestions([another,sigma,sigma],'sigma','self'),[sigma,another]);
 assert.deepEqual(inviteSuggestions([sigma,another],'sigma','user-sigma'),[another]);
 assert.deepEqual(inviteSuggestions([sigma,another],'sigma','self',[sigma]),[another]);
});
test('suggestion dropdown is bounded to twenty results',()=>{
 assert.equal(inviteSuggestions(Array.from({length:40},(_,i)=>player('u'+i,'Sigma '+i,'sig'+i)),'sig','self').length,20);
});
