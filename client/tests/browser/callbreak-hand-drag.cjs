// Run against a local Expo web export using the game-stats fixtures.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { fixture } = require('./game-stats.cjs');

const cards = ['2S','7S','AS','3C','KC','2H','5H','QH','AH','4D','8D','JD','KD'];
const order = hand => hand.getByTestId(/^callbreak-hand-card-/).evaluateAll(nodes => nodes.map(node => node.dataset.testid.replace('callbreak-hand-card-', '')));
async function hitPoint(page, card) {
  return card.evaluate(node => {
    const b = node.getBoundingClientRect();
    for (let y = Math.max(0, b.top + 3); y < Math.min(innerHeight, b.bottom - 3); y += 4) {
      for (let x = Math.max(0, b.left + 3); x < Math.min(innerWidth, b.right - 3); x += 4) {
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest('[data-testid^="callbreak-hand-card-"]') === node || hit?.closest('[data-testid^="drag-callbreak-hand-card-"]') === node.parentElement) return {x, y};
      }
    }
    return null;
  });
}
async function dragVisibleCard(page, hand) {
  await page.getByTestId('callbreak-hand-content').evaluate(node => node.scrollTop = 0);
  await page.waitForTimeout(150);
  const before = await order(hand);
  const points = [];
  for (const id of before) {
    const point = await hitPoint(page, hand.getByTestId(`callbreak-hand-card-${id}`));
    if (point) points.push({ id, point });
  }
  assert.ok(points.length >= 2, 'at least two cards must be reachable');
  const source = points.at(-1), target = points[0];
  await page.mouse.move(source.point.x, source.point.y); await page.mouse.down();
  await page.mouse.move(target.point.x, target.point.y, {steps: 20}); await page.mouse.up();
  await page.waitForTimeout(350);
  const after = await order(hand);
  assert.notDeepEqual(after, before, `drag should reorder ${source.id} towards ${target.id}`);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.equal(await hand.getByRole('button', {name:/^Play /}).count(), 0, 'drag must not select or play');
  return after;
}
function checkGrouping(sequence) {
  const suits = sequence.map(card => card.slice(-1)).filter((suit, index, all) => !index || suit !== all[index - 1]);
  assert.equal(new Set(suits).size, suits.length);
  assert.equal(suits.length, 4);
  for (let i = 1; i < suits.length; i++) assert.notEqual('HD'.includes(suits[i]), 'HD'.includes(suits[i - 1]));
}

(async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    for (const width of [320,390,1280]) {
      const f = await fixture(browser, 'callbreak', 4, width, false, snapshot => {
        snapshot.private.hand = cards; snapshot.private.legal_cards = ['2S'];
        snapshot.game.phase = 'PLAYING'; snapshot.game.turn.player_id = 1;
      });
      const {page} = f, hand = page.getByTestId('player-hand');
      if (await page.getByTestId('hand-attention-collapsed').count()) await page.getByTestId('hand-attention-collapsed').click();
      await hand.getByRole('button', {name:'Flip all cards',exact:true}).click();
      await hand.getByRole('button', {name:'Hand options',exact:true}).click();
      checkGrouping(await order(hand));
      for (const mode of ['Card grid view','Sorted fan view','Suit fan view']) {
        await hand.getByRole('radio', {name:mode,exact:true}).click();
        const after = await dragVisibleCard(page, hand);
        await hand.getByRole('button', {name:'Group by suit',exact:true}).click();
        const grouped = await order(hand); checkGrouping(grouped);
        assert.notDeepEqual(grouped, after);
      }
      await hand.getByRole('radio', {name:'Hearts, 4 cards',exact:true}).click();
      const filteredOrder = await dragVisibleCard(page, hand);
      await hand.getByRole('radio', {name:'Card grid view',exact:true}).click();
      const manual = await order(hand);
      assert.equal(manual.length, 13);
      assert.deepEqual(manual.filter(card => card.endsWith('H')), filteredOrder);
      await hand.getByRole('button', {name:'Hide cards',exact:true}).click();
      await hand.getByRole('button', {name:'Show cards',exact:true}).click();
      assert.deepEqual(await order(hand), manual);
      await page.getByTestId('hand-attention-expanded').click();
      await page.getByTestId('hand-attention-collapsed').click();
      assert.deepEqual(await order(hand), manual);
      await hand.getByRole('button', {name:'Select 2S',exact:true}).click();
      assert.equal(await hand.getByRole('button', {name:'Play 2S',exact:true}).count(), 1);
      await hand.getByRole('button', {name:'Cancel card selection',exact:true}).click();
      assert.equal(await hand.getByRole('button', {name:'Select 3C',exact:true}).isDisabled(), true);
      await page.screenshot({path:`/private/tmp/bhidne-callbreak-drag-${width}.png`});
      assert.ok(f.writes.every(p => !p.endsWith('/action')), 'reordering must remain local');
      assert.deepEqual(f.errors, []);
      console.log(`PASS ${width}: fan/grid/suit dragging, alternating regrouping, filtering and confirmation`);
      await f.context.close();
    }
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
