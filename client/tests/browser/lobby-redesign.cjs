const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path, user, body, method) {
  const response = await fetch(site + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, JSON.stringify(data)); return data;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const stamp = Date.now(), errors = [];
    const owner = await api('/auth/signup', null, { username: `lobby_${stamp}`, display_name: 'Prajwal', password: 'Lobby-test-123' });
    const friend = await api('/auth/signup', null, { username: `sita_${stamp}`, display_name: 'Sita Rai', password: 'Lobby-test-123' });
    await api('/me/profile/appearance', owner, { theme: 'heritage', mode: 'light' }, 'PATCH');
    const rooms = [];
    for (const name of ['Friday with friends', 'Chiya and cards', 'Family game night']) {
      const room = await api('/rooms', owner, { name }); rooms.push(room);
      await api(`/rooms/${room.room_id}/enter`, friend, {});
    }
    const game = await api(`/test-games/${rooms[0].room_id}`, owner, { game_type: 'callbreak', player_count: 4, name: 'Evening Call Break' });
    const outsideRoom = await api('/rooms', friend, { name: 'Join by code test' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ owner, site }) => {
      if (!sessionStorage.getItem(`bhidne.session.v1:${site}`)) sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: owner, room: null, game: null }));
    }, { owner, site });
    await page.goto(site);
    await page.getByTestId(`room-card-${rooms[0].room_id}`).waitFor();
    await page.getByTestId(`room-card-${rooms[0].room_id}`).getByText('2 members · 1 table', { exact: true }).waitFor();
    await page.getByTestId(`room-card-${rooms[0].room_id}`).getByLabel('Sita Rai', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: '/tmp/bhidne-lobby-reference-light.png', fullPage: true });
    const nav = page.getByTestId('lobby-navigation');
    await nav.getByRole('tab', { name: 'Games', exact: true }).click();
    await page.getByRole('heading', { name: 'Rooms with open tables', exact: true }).waitFor();
    assert.equal(await page.getByTestId(/^room-card-/).count(), 1);
    await nav.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: `Share ${rooms[0].name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Copy room code', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Copy room link', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close room sharing', exact: true }).click();
    await page.getByRole('button', { name: `Enter ${rooms[1].name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Back to lobby', exact: true }).waitFor();
    assert.equal(await nav.count(), 0);
    await page.getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await page.getByRole('tab', { name: 'Recent', exact: true }).click();
    await page.getByTestId(`room-card-${rooms[1].room_id}`).waitFor();
    await page.reload();
    await page.getByRole('tab', { name: 'Recent', exact: true }).click();
    await page.getByTestId(`room-card-${rooms[1].room_id}`).waitFor();
    await nav.getByRole('tab', { name: 'Friends', exact: true }).click();
    await page.getByText('Recently visited', { exact: true }).waitFor({ state: 'hidden' });
    await nav.getByRole('tab', { name: 'Profile', exact: true }).click();
    await page.getByTestId('profile-screen').waitFor();
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await page.getByText('Saved to your profile', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back from profile', exact: true }).click();
    await nav.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.screenshot({ path: '/tmp/bhidne-lobby-reference-dark.png', fullPage: true });
    await page.getByRole('button', { name: 'Join with code', exact: true }).click();
    await page.getByLabel('Room or table code', { exact: true }).fill(outsideRoom.room_id);
    await page.getByRole('button', { name: 'Join room', exact: true }).click();
    await page.getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
    await page.getByLabel('Room name', { exact: true }).fill('Created from refreshed lobby');
    await page.getByRole('button', { name: 'Create room', exact: true }).last().click();
    await page.getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId(/^room-card-/).first().waitFor();
    await page.screenshot({ path: '/tmp/bhidne-lobby-reference-desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS lobby: real previews/counts, sharing, enter/join/create, recent visits after reload, games, friends, profile, light/dark and desktop');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
