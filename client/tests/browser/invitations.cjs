// Backend :8000, Expo :8081. Real membership and game state; no game mocks.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
async function api(path, user, body) {
  const r = await fetch('http://localhost:8000' + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await r.json(); assert.ok(r.ok, `${path}: ${JSON.stringify(value)}`); return value;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const owner = await api('/auth/guest', null, { display_name: 'Host' });
    const room = await api('/rooms', owner, { name: `Invites ${Date.now()}` });
    await api(`/rooms/${room.room_id}/enter`, owner, {});
    const root = `/test-games/${room.room_id}`;
    const game = await api(root, owner, { game_type: 'flush', player_count: 2 });
    const roomUrl = `http://localhost:8081/?room=${room.room_id}`, gameUrl = `${roomUrl}&match=${game.match_id}`;
    const context = await browser.newContext({ viewport: { width: 360, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(), errors = [], posts = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname); });
    await page.goto(roomUrl);
    await page.getByRole('textbox', { name: 'Guest display name', exact: true }).fill('Invited guest');
    const loggedIn = page.waitForResponse(r => new URL(r.url()).pathname === '/auth/guest');
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
    const guest = await (await loggedIn).json();
    await page.getByRole('button', { name: 'Join room', exact: true }).waitFor();
    assert.equal((await api(`/rooms/${room.room_id}`, guest)).is_member, false);
    assert.equal(posts.filter(p => p.endsWith('/enter')).length, 0);
    await page.getByRole('button', { name: 'Join room', exact: true }).click();
    await page.getByRole('button', { name: 'Copy room link', exact: true }).waitFor();
    assert.equal((await api(`/rooms/${room.room_id}`, guest)).is_member, true);
    assert.equal((await api(root, guest)).your_player_id, null);
    assert.equal(new URL(page.url()).searchParams.has('room'), false);
    await page.getByRole('button', { name: 'Copy room link', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), roomUrl);
    await page.getByRole('button', { name: 'Copy game link', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), gameUrl);
    assert.equal(await page.getByRole('button', { name: 'Share game link', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Leave room', exact: true }).click();
    await page.getByText('LOBBY', { exact: true }).waitFor();
    await page.goto(gameUrl);
    await page.getByTestId('live-game-overlay').waitFor();
    assert.equal((await api(`/rooms/${room.room_id}`, guest)).is_member, true);
    assert.equal((await api(root, guest)).your_player_id, null);
    assert.equal(posts.filter(p => p === root + '/join').length, 0);
    await page.getByRole('button', { name: 'Back to room', exact: true }).click();
    await page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Leave room', exact: true }).click();
    await page.getByText('LOBBY', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('LOBBY', { exact: true }).waitFor();
    assert.equal((await api(`/rooms/${room.room_id}`, guest)).is_member, false);
    await page.goto(`${roomUrl}&match=obsolete`);
    await page.getByText('This game is no longer available. Ask for a new game link.', { exact: true }).waitFor();
    assert.equal((await api(`/rooms/${room.room_id}`, guest)).is_member, false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS: room preview/explicit join, copied/shared links, game room entry without seat, stale links, and no rejoin on reload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
