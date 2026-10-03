import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotRefreshClock } from '../src/multiplayer/SnapshotRefreshClock.ts';

test('a successful notification read at second 28 postpones the fallback poll until second 58',()=>{
 let now=0;const clock=new SnapshotRefreshClock(30000,()=>now);
 clock.success('room','match');now=28000;assert.equal(clock.delay('room','match'),2000);
 clock.success('room','match');assert.equal(clock.delay('room','match'),30000);
 now=30000;assert.equal(clock.delay('room','match'),28000);
 now=58000;assert.equal(clock.delay('room','match'),0);
});
test('other tables, replacements and failed reads cannot postpone the active game poll or command retries',()=>{
 let now=0;const clock=new SnapshotRefreshClock(30000,()=>now);
 clock.success('room','active');now=29000;clock.success('room','other');clock.success('other-room','active');
 assert.equal(clock.delay('room','active'),1000);assert.equal(clock.delay('room','new-match'),0);
 assert.equal(clock.delay('room','active',true),1000);
 assert.equal(clock.delay('room','active',false,true),1000);
 now=30000;assert.equal(clock.delay('room','active'),0);
});
