import test from 'node:test';
import assert from 'node:assert/strict';
import { seatedOrder, tableSeatGeometry } from '../src/multiplayer/tableSeats.ts';

test('viewer rotates down without changing clockwise seating; spectators retain server order', () => {
  const players = ['1','2','3','4','5'].map(id => ({id}));
  assert.deepEqual(seatedOrder(players,'3').map(p=>p.id),['3','4','5','1','2']);
  assert.deepEqual(seatedOrder(players,''),players);
  assert.deepEqual(players.map(p=>p.id),['1','2','3','4','5']);
});
test('two through five spatial seats stay separate and inside narrow/mobile and desktop tables', () => {
  for(const width of [256,280,336,760]) for(const compact of [false,true]) for(let count=2;count<=5;count++) {
    const layout=tableSeatGeometry(count,width,compact);
    assert.equal(layout.positions.length,count);
    assert.equal(layout.positions[0].x,width/2);
    assert.ok(layout.positions[0].y>layout.center.y);
    for(const [i,p] of layout.positions.entries()) {
      assert.ok(p.x-layout.seatWidth/2>=0 && p.x+layout.seatWidth/2<=width);
      assert.ok(p.y-layout.seatHeight/2>=0 && p.y+layout.seatHeight/2<=layout.height);
      for(const q of layout.positions.slice(i+1)) assert.ok(Math.abs(p.x-q.x)>=layout.seatWidth || Math.abs(p.y-q.y)>=layout.seatHeight,`${count} seats overlap at ${width}`);
    }
  }
});
