const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./game-stats.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const count of [4,5]) for (const width of [320,390,1280]) {
      const f = await fixture(browser, 'callbreak', count, width), {page} = f;
      const expanded = page.getByTestId('hand-attention-expanded'), collapsed = page.getByTestId('hand-attention-collapsed');
      if (await expanded.isVisible()) await expanded.click();
      await collapsed.waitFor(); await page.waitForTimeout(220);
      const geometry = async () => ({ viewport: await page.getByTestId('callbreak-play-viewport').boundingBox(),
        table: await page.getByTestId('card-table').boundingBox(),
        seats: await page.getByTestId(/^table-seat-/).evaluateAll(nodes => nodes.map(n => {
          const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];
        })) });
      const before = await geometry();
      await collapsed.click(); await expanded.waitFor(); await page.waitForTimeout(220);
      assert.deepEqual(await geometry(),before,'expanding hand must not resize the table or change seat geometry');
      const hand=await page.getByTestId('callbreak-mobile-hand').boundingBox();
      assert.ok(hand.y<before.viewport.y+before.viewport.height,'hand must overlay the play area');
      assert.ok(await page.getByTestId('callbreak-hand-content').isVisible());
      await expanded.click(); await collapsed.waitFor(); await page.waitForTimeout(220);
      assert.deepEqual(await geometry(),before,'collapsed table must retain its geometry');
      assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);
      await f.context.close();console.log(`PASS Call Break ${count} players ${width}px: hand overlays unchanged viewport, table and seats.`);
    }
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
