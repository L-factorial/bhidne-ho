const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
async function api(path, user, body) {
  const r = await fetch('http://localhost:8000' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await r.json(); assert.ok(r.ok, JSON.stringify(result)); return result;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const users = await Promise.all([0, 1].map(i => api('/auth/guest', null, { display_name: `Cue ${i}` })));
    const room = await api('/rooms', users[0], { name: `Cues ${Date.now()}` });
    for (const u of users) await api(`/rooms/${room.room_id}/enter`, u, {});
    const root = `/test-games/${room.room_id}`, game = await api(root, users[0], { game_type: 'flush', player_count: 2 });
    const contexts = [];
    async function pageFor(user, reducedMotion) {
      const context = await browser.newContext({ reducedMotion, viewport: { width: 1280, height: 1000 } }); contexts.push(context);
      await context.addInitScript(({ user, room }) => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000', JSON.stringify({ session: user, room, game: 'flush' })), { user, room });
      const page = await context.newPage(); await page.goto('http://localhost:8081'); return page;
    }
    const owner = await pageFor(users[0], 'no-preference');
    assert.equal(await owner.getByRole('button', { name: 'Lock game', exact: true }).isDisabled(), true);
    await api(root + '/join', users[1], { match_id: game.match_id });
    const other = await pageFor(users[1], 'no-preference'), reduced = await pageFor(users[0], 'reduce');
    async function pulse(page, label, animated = true) {
      const cue = page.getByRole('button', { name: label, exact: true }).getByTestId('action-cue');
      await cue.waitFor();
      const values = [];
      for (let i = 0; i < 5; i++) { values.push(await cue.evaluate(el => Number(getComputedStyle(el).opacity))); await page.waitForTimeout(250); }
      if (animated) assert.ok(Math.max(...values) - Math.min(...values) > 0.03, `${label}: ${values}`);
      else assert.ok(values.every(v => v === 1), `${label} respects reduced motion: ${values}`);
    }
    await pulse(owner, 'Lock game'); await pulse(reduced, 'Lock game', false);
    await owner.getByRole('button', { name: 'Lock game', exact: true }).click();
    await pulse(owner, 'Start game');
    await owner.getByRole('button', { name: 'Start game', exact: true }).click();
    const state = await api(root, users[0]), pages = [owner, other];
    const dealer = Number(state.game.turn.player_id) - 1;
    await pulse(pages[dealer], 'Deal cards');
    await pages[dealer].getByRole('button', { name: 'Deal cards', exact: true }).click();
    await pulse(pages[1 - dealer], 'Cut in half'); await pulse(pages[1 - dealer], 'Skip cut');
    for (const context of contexts) await context.close();
    console.log('PASS: disabled lock, animated lock/start/deal/cut/skip, and reduced motion.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
