const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./game-stats.cjs');

(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const width of [390,1280]) for (const kind of ['callbreak','marriage']) {
      const f = await fixture(browser,kind,4,width), {page} = f;
      const expanded=page.getByTestId('hand-attention-expanded');if(await expanded.count())await expanded.click();
      await page.waitForTimeout(250);
      const dock = page.getByTestId(kind === 'marriage' ? (width < 900 ? 'marriage-mobile-hand' : 'marriage-desktop-hand') : 'callbreak-mobile-hand');
      const surface = page.getByTestId(`table-surface-${kind}`);
      if(kind === 'callbreak') {
        const viewport = await page.getByTestId('callbreak-play-viewport').boundingBox();
        const table = await surface.boundingBox();
        assert.ok(Math.abs(table.y-viewport.y)<1,'table starts at top of play viewport');
        assert.ok(Math.abs(table.y+table.height+12-viewport.y-viewport.height)<1,`table fills viewport with a clean bottom gap: ${JSON.stringify({table,viewport})}`);
      } else {
        const bounds = await surface.boundingBox(), hand = await dock.boundingBox();
        assert.ok(Math.abs(bounds.y+bounds.height+12-hand.y)<2,'Marriage surface leaves a clean gap above the hand');
        const cards = await Promise.all(['discard','stock','maal'].map(id => page.getByTestId(`marriage-${id}-spot`).boundingBox()));
        assert.ok(cards.every(card => Math.abs(card.y-cards[0].y)<1),'cards have aligned top edges');
        for(const id of ['discard','stock','maal']) {
          const spot = page.getByTestId(`marriage-${id}-spot`);
          assert.ok(await spot.evaluate(n => n.nextElementSibling.getBoundingClientRect().y >= n.getBoundingClientRect().bottom),'labels are below cards');
        }
      }
      await page.screenshot({path:`/private/tmp/table-fill-${kind}-${width}.png`});
      assert.deepEqual(f.errors,[]); await f.context.close();
      console.log(`PASS ${kind} ${width}: table fills play area and cards align`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
