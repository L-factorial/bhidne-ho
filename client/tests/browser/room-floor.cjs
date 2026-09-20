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
    const stamp = Date.now(), password = 'Room-floor-test-123';
    const owner = await api('/auth/signup', null, { username: `floor_${stamp}`, password });
    const friend = await api('/auth/signup', null, { username: `friend_${stamp}`, password });
    const room = await api('/rooms', owner, { name: 'Saturday Gang' });
    await api(`/rooms/${room.room_id}/enter`, friend, {});
    async function open(user) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(({ user, room, site }) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: user, room, game: null })), { user, room, site });
      const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(site); await p.getByTestId('room-toolbar').waitFor(); return p;
    }
    const page = await open(owner);
    const toolbar = page.getByTestId('room-toolbar');
    await page.getByTestId('room-empty-tables').waitFor();
    assert.equal(await toolbar.getByRole('button', { name: 'Room tables', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: /Switch to .* mode/ }).count(), 0);
    await page.getByRole('button', { name: 'Open profile', exact: true }).click();
    await page.getByText('Language', { exact: true }).waitFor();
    await page.getByText('Appearance', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await page.getByRole('button', { name: 'Back from profile', exact: true }).click();
    await page.screenshot({ path: '/tmp/room-redesign-dark.png' });
    await page.getByRole('button', { name: 'Open profile', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await page.getByRole('button', { name: 'Back from profile', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Create table', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Ledger & settlements', exact: true }).count(), 0);
    const empty = await page.getByTestId('room-empty-tables').boundingBox(), bar = await toolbar.boundingBox();
    assert.ok(empty.height >= 260 && empty.y + empty.height <= bar.y + 1);
    assert.ok(bar.y + bar.height <= 844 && bar.y > 740);
    await page.screenshot({ path: '/tmp/room-floor-empty.png' });
    await toolbar.getByRole('button', { name: 'Room members', exact: true }).click();
    await page.getByTestId('room-sheet').getByRole('heading', { name: 'Members · 2', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Invite people', exact: true }).click();
    await page.getByText(room.room_id, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close room panel', exact: true }).click();
    await page.getByTestId('room-sheet').waitFor({ state: 'hidden' });
    await toolbar.getByRole('button', { name: 'More room actions', exact: true }).click();
    await page.getByRole('button', { name: 'Ledger & settlements', exact: true }).click();
    await page.getByRole('tab').filter({ hasText: 'Ledger' }).waitFor();
    assert.equal(await page.getByTestId('ledger-section-toggle').count(), 0);
    await page.getByRole('button', { name: 'Close room panel', exact: true }).click();
    await page.getByTestId('room-sheet').waitFor({ state: 'hidden' });
    await toolbar.getByRole('button', { name: 'More room actions', exact: true }).click();
    await page.getByRole('button', { name: 'Delete room', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm delete room', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('room-sheet').waitFor({ state: 'hidden' });
    await toolbar.getByRole('button', { name: 'Room chat', exact: true }).click();
    const composer = page.getByTestId('room-chat-window').getByRole('textbox');
    assert.equal(await page.getByRole('button', { name: 'Send chat message', exact: true }).isDisabled(), true);
    assert.equal(await page.getByText('0/500', { exact: true }).count(), 0);
    await composer.fill('x'.repeat(510));
    assert.equal((await composer.inputValue()).length, 500);
    await page.getByText('500/500', { exact: true }).waitFor();
    await composer.fill('First line\nSecond line\nThird line\nFourth line\nFifth line');
    assert.ok((await composer.boundingBox()).height <= 104);
    await page.waitForTimeout(300); // Let the sheet’s entrance animation finish before the visual capture.
    await page.screenshot({ path: '/tmp/room-redesign-chat.png' });
    await composer.fill('Keep my draft');
    await toolbar.getByRole('button', { name: 'Room members', exact: true }).click();
    assert.equal(await page.getByTestId('room-chat-window').count(), 0);
    await page.getByRole('button', { name: 'Close room panel', exact: true }).click();
    await page.getByTestId('room-sheet').waitFor({ state: 'hidden' });
    await api(`/rooms/${room.room_id}/chat`, friend, { text: 'Meet at the table' });
    await page.getByTestId('room-chat-unread').waitFor();
    await toolbar.getByRole('button', { name: 'Room chat', exact: true }).click();
    assert.equal(await page.getByTestId('room-chat-window').getByRole('textbox').inputValue(), 'Keep my draft');
    await page.getByText('Meet at the table', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('room-chat-unread').count(), 0);
    await page.getByRole('button', { name: 'Send chat message', exact: true }).click();
    await page.getByText('Keep my draft', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="room-chat-window"] textarea')?.value === '');
    assert.equal(await composer.inputValue(), '');
    assert.equal(await composer.evaluate(node => document.activeElement === node), true);
    await toolbar.getByRole('button', { name: 'Room chat', exact: true }).click();
    await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Marriage', exact: true }).click();
    await page.getByRole('button', { name: '2 players', exact: true }).click();
    await page.getByRole('button', { name: 'Create this table', exact: true }).click();
    await page.getByTestId('live-game-overlay').waitFor();
    assert.equal(await page.getByTestId('room-toolbar').count(), 0);
    await page.getByTestId('live-game-overlay').getByRole('button', { name: 'Back to lobby', exact: true }).click();
    await page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
    await toolbar.waitFor();
    assert.equal(await page.getByTestId('room-empty-tables').count(), 0);
    await page.getByRole('button', { name: 'Return to table · Marriage table', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/room-floor-populated.png' });
    const game = await api(`/test-games/${room.room_id}`, owner);
    await api(`/test-games/${room.room_id}/join`, friend, { match_id: game.match_id });
    await api(`/test-games/${room.room_id}/table/lock`, owner, { match_id: game.match_id });
    await api(`/test-games/${room.room_id}/start`, owner, { match_id: game.match_id, play_mode: 'manual' });
    await page.getByText('Chat · paused', { exact: true }).waitFor();
    assert.equal(await toolbar.getByRole('button', { name: 'Room chat', exact: true }).isDisabled(), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: '/tmp/room-floor-desktop.png' });
    // A visitor can explicitly leave from More; navigation itself did not remove membership.
    const visitor = await api('/auth/signup', null, { username: `visitor_${stamp}`, password });
    await api(`/rooms/${room.room_id}/enter`, visitor, {});
    const other = await open(visitor);
    await other.getByTestId('room-toolbar').getByRole('button', { name: 'More room actions', exact: true }).click();
    assert.equal(await other.getByRole('button', { name: 'Delete room', exact: true }).count(), 0);
    await other.getByRole('button', { name: 'Leave room membership', exact: true }).click();
    await other.getByText('Your rooms', { exact: true }).waitFor();
    assert.equal((await api(`/rooms/${room.room_id}`, visitor)).is_member, false);
    // A long membership list must scroll without moving the invite action off screen.
    await page.route('**/rooms', async route => {
      const response = await route.fetch();
      const rooms = await response.json();
      await route.fulfill({ response, json: rooms.map(item => item.room_id === room.room_id
        ? { ...item, members: [owner.user_id, ...Array.from({ length: 40 }, (_, i) => `offline_${i}`)] }
        : item) });
    });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.reload();
    await page.getByTestId('room-toolbar').getByRole('button', { name: 'Room members', exact: true }).click();
    await page.getByRole('heading', { name: 'Members · 41', exact: true }).waitFor();
    await page.getByLabel('Guest 41, Offline', { exact: true }).scrollIntoViewIfNeeded();
    const invite = page.getByRole('button', { name: 'Invite people', exact: true });
    const inviteBox = await invite.boundingBox();
    assert.ok(inviteBox.y >= 0 && inviteBox.y + inviteBox.height < 740);
    await invite.click();
    await page.getByText(room.room_id, { exact: true }).waitFor();
    await page.waitForTimeout(300); // Finish the sheet entrance animation for the capture.
    await page.screenshot({ path: '/tmp/room-redesign-members-320.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: room floor, empty CTA, toolbar, members/invite, ledger, owner controls, chat draft/unread, paused chat, gameplay boundary, explicit leave, mobile/desktop');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
