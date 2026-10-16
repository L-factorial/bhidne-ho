import test from 'node:test';
import assert from 'node:assert/strict';
import {resultPlayerLabel} from '../src/multiplayer/resultPlayerLabel.ts';
test('result labels show only You for the viewer and cap other names at eight characters',()=>{
 assert.equal(resultPlayerLabel('Player 1',true,'You'),'You');
 assert.equal(resultPlayerLabel('Anything',true,'तपाईं'),'तपाईं');
 assert.equal(resultPlayerLabel('Player 2',false,'You'),'Player 2');
 assert.equal(resultPlayerLabel('Alexander',false,'You'),'Alexa...');
 assert.equal(resultPlayerLabel('123456789',false,'You').length,8);
});
test('truncation does not split Unicode code points',()=>{
 const label=resultPlayerLabel('😀😀😀😀😀😀😀😀😀',false,'You');
 assert.equal(label,'😀😀😀😀😀...');assert.equal(Array.from(label).length,8);
});
