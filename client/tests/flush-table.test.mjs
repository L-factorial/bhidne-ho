import test from 'node:test';
import assert from 'node:assert/strict';
import { minimumArenaHeight, newBets, potBeforeFlights, playerPosition } from '../src/multiplayer/flushTable.ts';

test('coin flights select unseen event sequences and defer only pending contributions', () => {
  const bets = [{ sequence: 4, amount: 10, player_id: '1', kind: 'BET_PLACED' }, { sequence: 6, amount: 20, player_id: '2', kind: 'BET_PLACED' }];
  assert.deepEqual(newBets(bets, 4), [bets[1]]);
  assert.deepEqual(newBets(bets, 6), []);
  assert.equal(potBeforeFlights(40, bets), 10);
  assert.equal(potBeforeFlights(40, [bets[1]]), 20);
  assert.equal(potBeforeFlights(40, []), 40);
});
test('ellipse seats stay inside narrow and wide tables for two through five players', () => {
  for (const width of [280, 336, 640]) for (let n = 2; n <= 5; n++) {
    const positions = Array.from({length:n}, (_, i) => playerPosition(i, n, width));
    assert.equal(new Set(positions.map(p => `${p.x},${p.y}`)).size, n);
    for (const p of positions) { assert.ok(p.x >= 40 && p.x <= width - 40); assert.ok(p.y >= 40 && p.y <= 330); }
  }
});

test('compact ellipse keeps player markers inside the available vertical space', () => {
  for (let n=2; n<=5; n++) for (let i=0; i<n; i++) {
    const p=playerPosition(i,n,300,240);
    assert.ok(p.y - 38 >= 0 && p.y + 40 <= 240);
  }
});

test('two through ten seats stay separate and the first seat stays bottom center', () => {
  for (const width of [280, 344, 744, 1040]) for (let count=2; count<=10; count++) {
    const height = minimumArenaHeight(count, width);
    const seats = Array.from({length:count}, (_, i) => playerPosition(i, count, width, height));
    assert.ok(Math.abs(seats[0].x - width / 2) < 0.01);
    assert.ok(seats[0].y > height / 2);
    for (const [i, seat] of seats.entries()) {
      assert.ok(seat.x - 40 >= 0 && seat.x + 40 <= width);
      assert.ok(seat.y - 38 >= 0 && seat.y + 48 <= height);
      for (const other of seats.slice(i + 1)) {
        assert.ok(Math.abs(seat.x-other.x)>=80 || Math.abs(seat.y-other.y)>=86, `overlapping seats at ${width}x${height}, count ${count}`);
      }
    }
  }
});
