// VisualViewport simulation exercises browser layout; physical keyboard/device testing remains separate.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8097';
async function api(path, user, body) {
  const r = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
async function visibleHeight(page, height) {
  await page.evaluate(height => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => height });
    window.visualViewport.dispatchEvent(new Event('resize'));
  }, height);
  await page.waitForTimeout(150);
}
async function within(locator, height, message) {
  const box = await locator.boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= height + 1, `${message}: ${JSON.stringify(box)}`);
}
async function adjacent(field, action) {
  const a = await field.boundingBox(), b = await action.boundingBox();
  assert.ok(a && b && a.x + a.width <= b.x + 1 && Math.abs(a.y - b.y) < 15, `action is beside the input: ${JSON.stringify({a,b})}`);
}
async function unclipped(locator) {
  await locator.page().waitForTimeout(100);
  const clipping = await locator.evaluate(el => {
    const box = el.getBoundingClientRect();
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (!['auto', 'scroll', 'hidden'].includes(getComputedStyle(parent).overflowY)) continue;
      const clip = parent.getBoundingClientRect();
      if (box.top < clip.top - 1 || box.bottom > clip.bottom + 1) return { box: box.toJSON(), clip: clip.toJSON(), parent: parent.outerHTML.slice(0, 350) };
    }
    return null;
  });
  if (clipping) await locator.page().screenshot({ path: '/tmp/keyboard-clipping.png' });
  assert.equal(clipping, null, `focused field must not be clipped: ${JSON.stringify(clipping)}`);
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const button = name => page.getByRole('button', { name, exact: true });
    const field = name => page.getByLabel(name, { exact: true });
    const stamp = Date.now(), password = 'Keyboard-forms-123';
    await page.goto(site);
    await button('Sign in or create account').click(); await button('Sign up').click();
    await field('Profile name').fill('कीबोर्ड साथी'); await field('Profile name').press('Enter');
    assert.ok(await field('Username').evaluate(el => el === document.activeElement));
    await field('Username').fill(`keyboard_${stamp}`); await field('Username').press('Enter');
    assert.ok(await field('Password').evaluate(el => el === document.activeElement));
    await field('Password').fill(password); await visibleHeight(page, 340);
    await within(button('Create account'), 340, 'signup action above keyboard');
    const registered = page.waitForResponse(r => r.url().endsWith('/auth/signup') && r.status() === 201);
    await button('Create account').click(); const user = await (await registered).json();
    await visibleHeight(page, 844);
    await button('Open profile').waitFor();
    const friend = await api('/auth/signup', null, { username: `keyboard_friend_${stamp}`, password, display_name: 'Keyboard Friend' });
    await api(`/friends/requests/${friend.user_id}`, user, {}); await api(`/friends/requests/${user.user_id}/accept`, friend, {});
    await button('Open profile').click(); await page.waitForTimeout(350);
    await field('Game display name').fill('New keyboard name'); await visibleHeight(page, 340);
    await adjacent(field('Game display name'), button('Save display name'));
    await within(button('Save display name'), 340, 'name save stays beside focused input');
    await button('Save display name').click(); await page.getByText('Display name saved.', { exact: true }).waitFor();
    await visibleHeight(page, 844);
    const phrase = page.getByLabel(/^New personal phrase/);
    await phrase.fill('रमाइलो'); await visibleHeight(page, 340);
    await adjacent(phrase, button('Save personal phrase')); await within(button('Save personal phrase'), 340, 'phrase save visible');
    await button('Save personal phrase').click(); await button('Edit phrase रमाइलो').waitFor();
    await visibleHeight(page, 844);
    await button('Message').click(); const dm = field('Message Keyboard Friend');
    await dm.fill('First draft'); await visibleHeight(page, 340);
    await within(button('Send privately'), 340, 'private send above keyboard');
    let sent = 0;
    await page.route(`**/friends/${friend.user_id}/messages`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      sent++; await new Promise(resolve => setTimeout(resolve, 600)); return route.continue();
    });
    await button('Send privately').click(); await dm.fill('Next draft while sending');
    await page.getByText('First draft', { exact: true }).waitFor();
    assert.equal(await dm.inputValue(), 'Next draft while sending'); assert.equal(sent, 1);
    await page.unroute(`**/friends/${friend.user_id}/messages`);
    await page.route(`**/friends/${friend.user_id}/messages`, route => route.request().method() === 'POST' ? route.fulfill({ status: 400, json: { detail: 'Message test failure' } }) : route.continue());
    await button('Send privately').click(); await page.getByText('Message test failure', { exact: true }).first().waitFor();
    assert.equal(await dm.inputValue(), 'Next draft while sending');
    await button('Close private chat').click(); await visibleHeight(page, 844); await button('Message').click();
    assert.equal(await dm.inputValue(), 'Next draft while sending');
    await button('Close private chat').click(); await button('Back from profile').click();
    await button('Join with code').click();
    await field('Room or table code').fill('missing-room'); await visibleHeight(page, 340);
    await adjacent(field('Room or table code'), button('Join room')); await unclipped(field('Room or table code'));
    await within(button('Join room'), 340, 'room join beside code above keyboard');
    await button('Close room form').click(); await visibleHeight(page, 844);
    await button('Create room').click(); const createRoom = button('Create room').last();
    assert.equal(await createRoom.isDisabled(), true);
    await field('Room name').fill(`Keyboard room ${stamp}`); await visibleHeight(page, 340);
    await within(createRoom, 340, 'room create above keyboard');
    await adjacent(field('Room name'), createRoom);
    await button('Privacy & invitations +').click();
    await field('Find people to invite to room').fill('Keyboard');
    await adjacent(field('Find people to invite to room'), button('Search directory'));
    await unclipped(field('Find people to invite to room'));
    await page.route(site + '/rooms', route => route.request().method() === 'POST' ? route.fulfill({ status: 400, json: { detail: 'Room test failure' } }) : route.continue());
    await createRoom.click(); await page.getByText('Room test failure', { exact: true }).waitFor();
    assert.equal(await field('Room name').inputValue(), `Keyboard room ${stamp}`);
    await within(page.getByText('Room test failure', { exact: true }), 340, 'creation error stays with action');
    await page.unroute(site + '/rooms');
    await createRoom.click(); await page.getByRole('heading', { name: 'Tables', exact: true }).waitFor();
    await visibleHeight(page, 844); await button('Create table').click();
    assert.equal(await button('Create this table').isDisabled(), true);
    await field('Table name').fill('Keyboard table'); await visibleHeight(page, 340);
    await within(button('Create this table'), 340, 'table create above keyboard');
    await field('Find players to invite').fill('Keyboard');
    await adjacent(field('Find players to invite'), button('Search directory'));
    await unclipped(field('Find players to invite'));
    await unclipped(button('Search directory'));
    await within(button('Create this table'), 340, 'table create stays pinned while searching');
    await page.screenshot({ path: '/tmp/keyboard-create-table.png' });
    await button('Create this table').click(); await page.getByTestId('live-game-overlay').waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS: signup focus/submit, profile and phrase actions, private drafts, room/table creation with reduced visual viewport');

    for (const kind of ['callbreak', 'marriage', 'flush']) {
      const snapshot = JSON.parse(fs.readFileSync(`/tmp/bhidne-social-${kind}.json`));
      snapshot.status = 'waiting'; snapshot.is_creator = true; snapshot.rule_proposal = null;
      if (kind === 'flush') snapshot.flush_settings.locked = false;
      const room = { room_id: 'room', name: 'Keyboard rules', members: ['u0'], connected_members: ['u0'] };
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(({ room, site, kind }) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: kind })), { room, site, kind });
      await context.route(site + '/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/' || path.startsWith('/_expo/') || path.startsWith('/assets/') || path === '/favicon.ico') return route.continue();
        return route.fulfill({ json: path.startsWith('/test-games/') ? snapshot : path === '/rooms' ? [room] : [] });
      });
      await context.routeWebSocket(site.replace(/^http/, 'ws') + '/**', ws => {
        ws.send(JSON.stringify({ type: 'CONNECTED' }));
        ws.onMessage(raw => { if (JSON.parse(raw).type === 'HEARTBEAT') ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' })); });
      });
      const p = await context.newPage(); p.setDefaultTimeout(10000);
      p.on('pageerror', e => errors.push(e.message));
      await p.goto(site); await p.getByRole('button', { name: /Return to table/ }).first().click();
      await p.getByRole('button', { name: 'Table menu', exact: true }).click();
      await p.getByRole('button', { name: 'Rules', exact: true }).click();
      const numeric = p.getByRole('textbox').filter({ visible: true }).first();
      await numeric.fill('12'); await visibleHeight(p, 340);
      const propose = p.getByRole('button', { name: kind === 'callbreak' ? 'Propose rules & bets' : kind === 'marriage' ? 'Propose scoring rules' : 'Propose Flush rules', exact: true });
      await within(propose, 340, `${kind} proposal visible above keyboard`);
      await within(numeric, 340, `${kind} focused number visible`);
      await p.screenshot({ path: `/tmp/keyboard-${kind}-rules.png` });
      await unclipped(numeric);
      await p.keyboard.press('Escape');
      await propose.waitFor({ state: 'hidden' });
      await visibleHeight(p, 844);
      if (!await p.getByTestId(kind + '-menu-drawer').count()) await p.getByRole('button', { name: 'Table menu', exact: true }).click();
      await p.getByRole('button', { name: 'Poke the table', exact: true }).click();
      const poke = p.getByLabel('Poke message, 30 characters maximum', { exact: true });
      await poke.fill('रमाइलो खेल'); await visibleHeight(p, 340);
      await within(p.getByRole('button', { name: 'Send poke to everyone', exact: true }), 340, 'poke arrow above keyboard');
      await unclipped(poke);
      await p.getByRole('button', { name: 'Close poke composer', exact: true }).click();
      assert.deepEqual(errors, []);
      await context.close(); console.log(`PASS: ${kind} numeric rules and persistent proposal action`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
