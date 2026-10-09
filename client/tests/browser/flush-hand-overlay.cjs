const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./game-stats.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [320,390,1280]) {
      const f = await fixture(browser, 'flush', 4, width), {page} = f;
      const expanded = page.getByTestId('hand-attention-expanded');
      const collapsed = page.getByTestId('hand-attention-collapsed');
      if (await expanded.isVisible()) await expanded.click();
      await collapsed.waitFor();
      const geometry = async () => ({
        viewport: await page.getByTestId('flush-play-viewport').boundingBox(),
        arena: await page.getByTestId('flush-arena').boundingBox(),
      });
      const before = await geometry();
      await collapsed.click(); await expanded.waitFor();
      assert.deepEqual(await geometry(), before, 'hand expansion must not resize or move the play area');
      const dock = await page.getByTestId('flush-hand-dock').boundingBox();
      assert.ok(dock.y < before.viewport.y+before.viewport.height, 'expanded hand overlays the play area');
      assert.ok(dock.y+dock.height <= (await page.getByTestId('flush-main-column').boundingBox()).y+
        (await page.getByTestId('flush-main-column').boundingBox()).height+1);
      await page.getByTestId('flush-own-cards').getByRole('button', { name: 'Tap to see cards', exact: true }).click();
      await expanded.click(); await collapsed.waitFor();
      assert.deepEqual(await geometry(), before);
      await collapsed.click(); await expanded.waitFor();
      assert.ok(await page.getByRole('button', { name: 'Hide cards', exact: true }).isVisible(), 'local card reveal survives collapse');
      await page.getByTestId('game-stats-toggle').click();
      await page.getByTestId('game-stats-overlay').waitFor(); await collapsed.waitFor();
      assert.deepEqual(await geometry(), before, 'summary must use the unchanged play area');
      await collapsed.click(); await expanded.waitFor();
      await page.getByTestId('game-stats-overlay').waitFor({state:'hidden'});
      assert.deepEqual(await geometry(), before);
      assert.deepEqual(f.errors,[]); assert.deepEqual(f.writes,[]);
      await f.context.close(); console.log(`PASS Flush ${width}px: overlay geometry, reveal persistence and summary/hand switching.`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
