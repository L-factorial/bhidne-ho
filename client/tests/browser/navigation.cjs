// Run against a local FastAPI server serving the Expo web export.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8096';
async function api(path, user, body) {
  const response = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const roomName = `Navigation ${Date.now()}`;
    const username = `nav_${Date.now()}`, password = 'Navigation-test-123';
    const owner = await api('/auth/signup', null, { username, password });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(site);
    await page.getByRole('button', { name: 'Sign in or create account', exact: true }).click();
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await page.getByText('Your rooms', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
    await page.getByRole('textbox', { name: 'Room name', exact: true }).fill(roomName);
    await page.getByRole('button', { name: 'Create room', exact: true }).last().click();
    await page.getByRole('heading', { name: 'Tables', exact: true }).waitFor();
    const room = (await api('/rooms', owner)).find(r => r.name === roomName);
    await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Marriage', exact: true }).click();
    await page.getByRole('button', { name: '2 players', exact: true }).click();
    await page.getByRole('button', { name: 'Create this table', exact: true }).click();
    await page.getByTestId('live-game-overlay').waitFor();
    const first = await api(`/test-games/${room.room_id}`, owner);
    await page.getByTestId('live-game-overlay').getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await page.getByRole('button', { name: 'Return to table · Marriage table', exact: true }).waitFor();
    await page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await page.getByRole('button', { name: `Enter ${roomName}`, exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/bhidne-navigation-lobby.png' });
    assert.ok((await api(`/rooms/${room.room_id}`, owner)).is_member);
    assert.ok((await api(`/test-games/${room.room_id}`, owner)).table.current_user.is_seated);
    await page.getByRole('button', { name: `Return to table · ${roomName}`, exact: true }).click();
    await page.getByTestId('live-game-overlay').waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Return to table · Marriage table', exact: true }).click();
    await page.getByTestId('live-game-overlay').waitFor();

    async function visitor(label) {
      const user = await api('/auth/signup', null, { username: `${label}_${Date.now()}`, password });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(({ user, site }) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: user, room: null, game: null })), { user, site });
      const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(site);
      await p.getByRole('button', { name: 'Join with code', exact: true }).click();
      await p.getByRole('textbox', { name: 'Room code', exact: true }).fill(room.room_id);
      await p.getByRole('button', { name: 'Join room', exact: true }).click();
      await p.getByRole('heading', { name: 'Tables', exact: true }).waitFor();
      return { user, page: p };
    }
    const second = await visitor('Second');
    await second.page.getByRole('button', { name: 'Take seat · Marriage table', exact: true }).click();
    await second.page.getByTestId('live-game-overlay').waitFor();
    const third = await visitor('Third');
    await third.page.getByRole('button', { name: 'Join queue · Marriage table', exact: true }).click();
    await third.page.getByTestId('live-game-overlay').waitFor();
    assert.equal((await api(`/test-games/${room.room_id}`, third.user)).table.current_user.queue_position, 1);
    await third.page.getByTestId('live-game-overlay').getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await third.page.getByText('Queue #1', { exact: true }).waitFor();
    await third.page.getByRole('button', { name: 'Watch · Marriage table', exact: true }).click();
    await third.page.getByTestId('live-game-overlay').waitFor();
    assert.equal((await api(`/test-games/${room.room_id}`, third.user)).table.current_user.is_seated, false);
    // Create a different table, then ensure watching the first stays pinned through polling.
    const host2 = await api('/auth/signup', null, { username: `host_${Date.now()}`, password });
    await api(`/rooms/${room.room_id}/enter`, host2, {});
    await api(`/test-games/${room.room_id}`, host2, { name: 'Other table', game_type: 'flush', player_count: 2 });
    await third.page.waitForTimeout(2300);
    await third.page.getByTestId('live-game-overlay').getByRole('heading', { name: 'Marriage', exact: true }).waitFor();
    await third.page.getByTestId('live-game-overlay').getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await third.page.getByRole('button', { name: 'Watch · Other table', exact: true }).click();
    await third.page.getByTestId('flush-table').waitFor();
    await third.page.waitForTimeout(1500);
    await third.page.getByTestId('flush-table').waitFor();
    assert.equal((await api(`/test-games/${room.room_id}?match_id=${first.match_id}`, third.user)).table.current_user.queue_position, 1);
    await third.page.getByTestId('live-game-overlay').getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await third.page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
    const rival = await api('/auth/signup', null, { username: `rival_${Date.now()}`, password });
    await api(`/rooms/${room.room_id}/enter`, rival, {});
    await third.page.route(`**/test-games/${room.room_id}/join`, async route => {
      await api(`/test-games/${room.room_id}/join`, rival, route.request().postDataJSON());
      await route.continue();
    });
    const conflict = third.page.waitForResponse(r => r.url().endsWith(`/test-games/${room.room_id}/join`) && r.status() === 409);
    await third.page.getByRole('button', { name: 'Take seat · Other table', exact: true }).click();
    await conflict;
    await third.page.getByRole('button', { name: 'Join queue · Other table', exact: true }).waitFor();
    assert.equal(await third.page.getByTestId('live-game-overlay').count(), 0);
    await third.page.screenshot({ path: '/tmp/bhidne-navigation-room.png' });
    await third.page.setViewportSize({ width: 1280, height: 900 });
    await third.page.screenshot({ path: '/tmp/bhidne-navigation-desktop.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: login, create room/table, join room, seat, watch, queue, return, reload, back, table switching, and a last-seat race');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
