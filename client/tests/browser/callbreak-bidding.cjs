// Mock snapshots and commands only; no live game mutations.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./game-stats.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [320, 390, 1280]) {
      const f = await fixture(browser, 'callbreak', 4, width, false, s => {
        s.game.phase = 'BIDDING'; s.game.turn.player_id = 1;
        s.deal.players.forEach(p => { p.bid = null; });
        s.private.can_accept_hand = false; s.private.can_claim_redeal = false;
      });
      const { page } = f;
      const collapsed = page.getByTestId('hand-attention-collapsed');
      if (await collapsed.isVisible()) await collapsed.click();
      await page.getByTestId('hand-attention-expanded').waitFor();
      assert.match(await page.getByTestId('hand-attention-expanded').textContent(), /Place your bid/);
      await page.getByRole('button', { name: 'Flip all cards', exact: true }).click();
      const bid = page.getByTestId('callbreak-bid-prompt');
      const increase = bid.getByRole('button', { name: 'Increase bid', exact: true });
      await increase.waitFor();
      const glow = bid.getByTestId('turn-glow');
      const opacity = [];
      for (let i = 0; i < 6; i++) {
        opacity.push(await glow.evaluate(n => Number(getComputedStyle(n).opacity)));
        await page.waitForTimeout(180);
      }
      assert.ok(Math.max(...opacity) - Math.min(...opacity) > 0.1, 'bidding section pulses');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(250);
      const still = await glow.evaluate(n => Number(getComputedStyle(n).opacity));
      await page.waitForTimeout(250);
      assert.equal(await glow.evaluate(n => Number(getComputedStyle(n).opacity)), still, 'reduced motion keeps a steady border');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.equal(await bid.getByLabel('Selected bid 1').count(), 1);
      await increase.click();
      await bid.getByRole('button', { name: 'Decrease bid', exact: true }).click();
      const controls = await Promise.all([
        bid.getByRole('button', { name: 'Decrease bid', exact: true }).boundingBox(),
        bid.getByLabel('Selected bid 1').boundingBox(), increase.boundingBox(),
        bid.getByRole('button', { name: 'Bid', exact: true }).boundingBox(),
      ]);
      assert.ok(controls.every(b => Math.abs(b.y - controls[0].y) < 15), 'bid controls stay on one row');
      await increase.click();
      await f.context.route('**/test-games/room/action', async route => {
        const command = route.request().postDataJSON();
        assert.equal(command.command, 'PLACE_BID');
        assert.equal(command.payload.amount, 2);
        f.change(s => {
          s.game.revision++; s.deal.players[0].bid = 2; s.game.turn.player_id = 2;
          s.action_ack = { command_id: command.command_id, status: 'accepted', revision: s.game.revision };
        });
        await route.fallback();
      });
      await bid.getByRole('button', { name: 'Bid', exact: true }).click();
      await bid.waitFor({ state: 'hidden' });
      assert.ok(f.writes.some(p => p.endsWith('/action')));
      assert.deepEqual(f.errors, []);
      await f.context.close();
      console.log(`PASS bidding ${width}: label, default, stepper, same-row action, accepted bid hides section`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
