// Real backend :8000 and Expo :8081. Shared controls must follow the game header.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://localhost:8081';
async function api(path, user, body) {
  const r = await fetch('http://localhost:8000' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await r.json(); assert.ok(r.ok, JSON.stringify(result)); return result;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['callbreak', 'marriage', 'flush']) {
      const count = kind === 'callbreak' ? 4 : 2;
      const users = await Promise.all(Array.from({ length: count }, () => api('/auth/guest', null, { display_name: 'Footer tester' })));
      const room = await api('/rooms', users[0], { name: `Footer ${kind} ${Date.now()}` });
      for (const u of users) await api(`/rooms/${room.room_id}/enter`, u, {});
      const root = `/test-games/${room.room_id}`, game = await api(root, users[0], { game_type: kind, player_count: count });
      for (const u of users.slice(1)) await api(root + '/join', u, { match_id: game.match_id });
      for (const width of [360, 1280]) {
        const context = await browser.newContext({ viewport: { width, height: 850 }, permissions: ['clipboard-read', 'clipboard-write'] });
        await context.addInitScript(({ user, room, kind }) => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000', JSON.stringify({ session: user, room, game: kind })), { user: users[0], room, kind });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(site);
        const overlay = page.getByTestId('live-game-overlay'), footer = page.getByTestId('game-footer');
        await overlay.waitFor();
        if (kind === 'flush' && width < 900) {
          assert.equal(await overlay.getByRole('button', { name: 'Copy game link', exact: true }).count(), 0);
          await overlay.getByRole('button', { name: 'Table menu', exact: true }).click();
          await overlay.getByTestId('table-lifecycle').waitFor();
          await overlay.getByRole('button', { name: 'Table menu', exact: true }).click();
          await context.close(); continue;
        }
        await footer.waitFor();
        const back = await overlay.getByRole('button', { name: 'Back to room', exact: true }).boundingBox();
        const bounds = await footer.boundingBox();
        assert.ok(bounds.y >= back.y + back.height, `${kind} ${width}: footer follows header`);
        assert.ok(bounds.y + bounds.height <= 851, `${kind} ${width}: footer fits viewport`);
        assert.equal(await footer.getByTestId('table-lifecycle').count(), 1);
        assert.equal(await overlay.getByRole('button', { name: 'Room chat', exact: true }).count(), 1);
        assert.equal(await overlay.getByRole('button', { name: 'Share game link', exact: true }).count(), 0);
        await footer.getByRole('button', { name: 'Copy game link', exact: true }).click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${site}/?room=${room.room_id}&match=${game.match_id}`);
        const dock = page.getByTestId('chat-dock');
        const collapsed = await dock.boundingBox();
        assert.ok(collapsed.height <= 56, 'collapsed chat is a compact row');
        assert.ok(collapsed.y + collapsed.height >= 820, 'chat is anchored at the viewport bottom');
        if (width === 1280) assert.ok(collapsed.x > 800 && collapsed.width <= 360, 'wide chat is bottom-right');
        else assert.ok(collapsed.width >= 320, 'mobile chat spans the bottom');
        await overlay.getByRole('button', { name: 'Room chat', exact: true }).click();
        await page.getByRole('textbox', { name: 'Room chat message', exact: true }).fill('Keep this draft');
        await page.getByRole('button', { name: 'Close chat', exact: true }).click();
        await overlay.getByRole('button', { name: 'Back to room', exact: true }).click();
        await overlay.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Room chat', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: 'Room chat message', exact: true }).inputValue(), 'Keep this draft');
        await page.getByRole('button', { name: 'Close chat', exact: true }).click();
        assert.deepEqual(errors, []);
        await context.close();
      }
      console.log(`${kind}: bottom footer, single copy control and chat overlay passed at 360/1280px`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
