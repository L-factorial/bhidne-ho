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

    await page.getByRole('button', { name: `Enter ${rooms[0].name}`, exact: true }).click();
    await page.getByTestId('room-hero').waitFor();
    await page.getByTestId(`table-preview-${game.match_id}`).waitFor();
    await page.screenshot({ path: '/tmp/bhidne-room-reference-light.png', fullPage: true });
    await page.getByRole('button', { name: 'Room members', exact: true }).click();
    await page.getByRole('heading', { name: 'Members · 2', exact: true }).waitFor();
    await page.getByRole('button', { name: /^Sita Rai, (Online|Offline)$/ }).click();
    await page.getByRole('heading', { name: 'Player profile', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add friend', exact: true }).click();
    await page.getByText('Friend request sent', { exact: true }).waitFor();
    assert.ok((await api('/friends', owner)).outgoing.some(player => player.user_id === friend.user_id));
    await page.getByRole('button', { name: 'Close player profile', exact: true }).click();
    await page.getByRole('button', { name: 'Room ledger', exact: true }).click();
    await page.getByRole('heading', { name: 'Ledger & settlements', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Show room/table codes', exact: true }).click();
    await page.getByRole('button', { name: 'Hide room/table codes', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Room tables', exact: true }).click();
    await page.getByTestId('room-sheet').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Room chat', exact: true }).click();
    await page.getByTestId('room-chat-window').waitFor();
    await page.getByRole('button', { name: 'Room tables', exact: true }).click();
    await page.getByTestId('room-sheet').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Invite to room', exact: true }).click();
    await page.getByRole('button', { name: 'Copy room link', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Room tables', exact: true }).click();
    await page.getByTestId('room-sheet').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'More room actions', exact: true }).click();
    await page.getByRole('heading', { name: 'Room options', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Room tables', exact: true }).click();
    await page.getByTestId('room-sheet').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Open profile', exact: true }).click();
    assert.equal(await page.getByRole('radio', { name: /^(Dark|Light|System)$/ }).count(), 0);
    await page.getByRole('button', { name: 'Back from profile', exact: true }).click();
    await page.screenshot({ path: '/tmp/bhidne-room-reference-fixed.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: '/tmp/bhidne-room-reference-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await page.getByRole('heading', { name: 'Create table', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to room', exact: true }).click();
    await page.getByRole('button', { name: 'Return to table · Evening Call Break', exact: true }).click();
    await page.getByTestId('live-game-backdrop').waitFor();
    await page.getByTestId('pregame-table').waitFor();
    assert.equal(await page.getByLabel('Empty seat', { exact: true }).count(), 3);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(350); // Let the existing game-modal fade finish before visual capture.
    await page.screenshot({ path: '/tmp/bhidne-pregame-refined-320.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Room redesign: navigation, members, ledger, chat, invitations, settings and creation passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
