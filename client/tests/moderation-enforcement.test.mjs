import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveRemovals } from '../src/components/moderation/messages.ts';
import { mergeTableMessages } from '../src/multiplayer/TableSocialChannel.ts';
test('older history cannot restore removed content and blocked rows stay absent',()=>{
 const removed={id:'one',removed:true,text:'Removed',sent_at:1};
 assert.deepEqual(preserveRemovals([removed],[{id:'one',text:'old'}]),[removed]);
 assert.deepEqual(preserveRemovals([removed],[]),[]);
 assert.deepEqual(mergeTableMessages([removed],[{id:'one',text:'old',sent_at:1}]),[removed]);
});
