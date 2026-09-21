// Integration test against a local backend and exported web client.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path, user, body) {
  const response = await fetch(site + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const users = [];
    for (let i = 0; i < 3; i++) users.push(await api('/auth/signup', null, {
      username: `ended_${Date.now()}_${i}`, password: 'Local-test-password', display_name: `Player ${i}` }));
    const room = await api('/rooms', users[0], { name: 'Release test' });
    for (const user of users) await api(`/rooms/${room.room_id}/enter`, user, {});
    const root = `/test-games/${room.room_id}`;
    const old = await api(root, users[0], { name: 'Old table', game_type: 'marriage', player_count: 2 });
    await api(root + '/join', users[1], { match_id: old.match_id });
    await api(root + '/table/lock', users[0], { match_id: old.match_id });
    const next = await api(root, users[2], { name: 'New table', game_type: 'marriage', player_count: 2 });
    const context = await browser.newContext();
    await context.addInitScript(({ site, session, room }) => sessionStorage.setItem(`bhidne.session.v1:${site}`,
      JSON.stringify({ session, room, game: null })), { site, session: users[1], room });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(site);
    const takeSeat = page.getByTestId(`table-card-${next.match_id}`).getByRole('button', { name: /Take.*seat|Join table/i });
    await takeSeat.click();
    await page.getByText('Previous table is reserved', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Leave previous table', exact: true }).count(), 0);
    await api(root + '/end', users[0], { match_id: old.match_id });
    await page.getByText('Previous table is reserved', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId(`table-card-${old.match_id}`).count(), 0);
    await takeSeat.click();
    await page.getByTestId('live-game-overlay').waitFor();
    await api(root + '/table/lock', users[2], { match_id: next.match_id });
    assert.equal((await api(root + '/start', users[2], { match_id: next.match_id })).status, 'playing');
    await api(root + '/end', users[2], { match_id: next.match_id });
    await page.getByTestId('room-empty-tables').waitFor();
    await page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId(`table-card-${next.match_id}`).count(), 0);
    const memberships = await api('/memberships', users[1]);
    assert.deepEqual(memberships.find(value => value.room_id === room.room_id).tables, []);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Ended-table browser check passed: conflict cleared, player seated, new game started.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
