import test from 'node:test';
import assert from 'node:assert/strict';
import {tableHeaderLocation} from '../src/multiplayer/tableHeaderLocation.ts';

test('room/table labels at the 25-character boundary remain unchanged',()=>{
  assert.equal(tableHeaderLocation('Hamro family','Table-1'),'Hamro family → Table-1');
  const room='R'.repeat(15);
  assert.equal(tableHeaderLocation(room,'Table-1'),`${room} → Table-1`);
  assert.equal(Array.from(tableHeaderLocation(room,'Table-1')).length,25);
  assert.equal(tableHeaderLocation('AB','T'.repeat(20)),`AB → ${'T'.repeat(20)}`);
});

test('one character over the limit reserves all three dots and preserves the table',()=>{
  const label=tableHeaderLocation('R'.repeat(16),'Table-1');
  assert.equal(label,`${'R'.repeat(12)}... → Table-1`);
  assert.equal(Array.from(label).length,25);
  assert.equal(tableHeaderLocation('R'.repeat(80),'Table-1'),label);
});

test('Unicode names are counted without splitting supplementary characters',()=>{
  const label=tableHeaderLocation('😀'.repeat(16),'Table-1');
  assert.equal(label,`${'😀'.repeat(12)}... → Table-1`);
  assert.equal(Array.from(label).length,25);
});

test('fallback paths use the same room-only truncation',()=>{
  const path=`${'R'.repeat(16)} → Table-1`;
  assert.equal(tableHeaderLocation('','Table-1',path),`${'R'.repeat(12)}... → Table-1`);
  assert.equal(tableHeaderLocation('','Table-1'),'Table-1');
  assert.equal(tableHeaderLocation('','',''),'');
});

test('even an unusually long table or plain fallback cannot exceed the cap',()=>{
  assert.equal(tableHeaderLocation('Room','T'.repeat(40)),`... → ${'T'.repeat(16)}...`);
  assert.equal(Array.from(tableHeaderLocation('','T'.repeat(40))).length,25);
  assert.equal(Array.from(tableHeaderLocation('','','P'.repeat(40))).length,25);
});
