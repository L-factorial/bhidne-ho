const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path, user, body) {
  const r = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(site);
    await page.getByRole('button', { name: 'Switch language to नेपाली', exact: true }).click();
    await page.getByRole('button', { name: /English/ }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('bhidne.language')), 'ne');
    await page.reload();
    await page.getByRole('button', { name: /English/ }).waitFor();
    const user = await api('/auth/signup', null, { username: `locale_${Date.now()}`, password: 'Locale-test-123', display_name: 'Fold' });
    await page.evaluate(({ user, site }) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: user, room: null, game: null })), { user, site });
    await page.reload();
    await page.getByRole('button', { name: 'कोठा बनाउने', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'कोठाको नाम', exact: true }).fill('Home');
    await page.getByTestId('room-sheet').getByRole('button', { name: 'कोठा बनाउने', exact: true }).click();
    await page.getByRole('button', { name: 'टेबल बनाउने', exact: true }).waitFor();
    assert.ok((await page.locator('body').innerText()).includes('Home'), 'Room name must remain unchanged');
    const rooms = await api('/rooms', user), room = rooms.find(r => r.name === 'Home');
    assert.ok(room);
    await page.screenshot({ path: '../build/nepali-room.png', fullPage: true });
    const guests = [];
    for (let index = 0; index < 3; index++) {
      guests.push(await api('/auth/signup', null, { username: `locale_guest_${Date.now()}_${index}`, password: 'Locale-test-123', display_name: `Guest ${index}` }));
    }
    await api(`/rooms/${room.room_id}/invitations`, user, { invitees: guests.map(g => g.user_id) });
    for (const guest of guests) await api(`/rooms/${room.room_id}/enter`, guest, {});
    for (const game of ['callbreak', 'flush', 'marriage']) {
      const table = await api(`/test-games/${room.room_id}`, user, { game_type: game, player_count: game === 'callbreak' ? 4 : game === 'flush' ? 10 : 2, name: 'Start game' });
      for (const guest of guests.slice(0, game === 'callbreak' ? 3 : 1)) await api(`/test-games/${room.room_id}/join`, guest, { match_id: table.match_id });
      await page.evaluate(({ user, room, game, site }) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: user, room, game })), { user, room, game, site });
      await page.goto(`${site}/?room=${room.room_id}&match=${table.match_id}`);
      await page.getByRole('button', { name: /टेबल मेनु|Table menu/ }).waitFor();
      if (game !== 'callbreak') await page.getByRole('button', { name: 'खेलाडी पक्का गर्ने', exact: true }).click();
      await page.getByRole('button', { name: 'खेल सुरु गर्ने', exact: true }).click();
      await page.getByRole('button', { name: 'खेल सुरु गर्ने', exact: true }).waitFor({ state: 'hidden' });
      const started = await api(`/test-games/${room.room_id}?match_id=${table.match_id}`, user);
      assert.equal(started.status, 'playing', 'Localized buttons must send valid server commands');
      assert.ok((await page.locator('body').innerText()).includes('Start game'), 'Table name must not be translated');
      assert.ok((await page.locator('body').innerText()).includes('Fold'), 'Player name must not be translated');
      await page.getByRole('button', { name: /टेबल मेनु|Table menu/ }).click();
      await page.getByRole('button', { name: /^भाषा,/ }).click();
      await page.getByRole('button', { name: 'Language, English', exact: true }).waitFor();
      assert.equal((await api(`/test-games/${room.room_id}?match_id=${table.match_id}`, user)).status, 'playing');
      await page.getByRole('button', { name: 'Language, English', exact: true }).click();
      await page.getByRole('button', { name: /^भाषा,/ }).waitFor();
      console.log(`PASS ${game}: Nepali lock/start, preserved names, language switch during play`);
      await api(`/test-games/${room.room_id}/end`, user, { match_id: table.match_id });
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS: Nepali preference, room creation, names, and all three game screens');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
