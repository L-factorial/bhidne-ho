// PYTHONPATH=. .venv/bin/python scripts/social_browser_fixtures.py
// Serve a web export. Fixtures isolate UI behavior; no gameplay commands are allowed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function exerciseChat(page, label, sendLabel, listId, closeLabel, reopen) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  for (let i = 0; i < 4; i++) {
    await input.fill(`Message ${i}\nStill typing`);
    await page.getByRole('button', { name: sendLabel, exact: true }).click();
    await page.getByTestId(listId).getByText(`Message ${i}\nStill typing`, { exact: true }).waitFor();
    await page.waitForFunction(label => document.querySelector(`textarea[aria-label="${label}"]`).value === '', label);
    await input.pressSequentially('Next draft', { delay: 20 });
    assert.equal(await input.inputValue(), 'Next draft', `typing cycle ${i}; active=${await page.evaluate(() => document.activeElement?.outerHTML.slice(0,250))}`);
    assert.ok(await input.evaluate(el => el === document.activeElement), 'input retains focus after message updates');
  }
  // Model a mobile browser emitting visualViewport scroll after scrollIntoView.
  // Count calls rather than allowing the old feedback loop to hang the runner.
  await page.evaluate(() => {
    window.revealCalls = 0;
    window.originalReveal = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function () {
      window.revealCalls++;
      if (window.revealCalls < 30) window.visualViewport.dispatchEvent(new Event('scroll'));
    };
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(600);
  assert.ok(await page.evaluate(() => window.revealCalls <= 1), 'keyboard resize must not create a scroll feedback loop or background-frame reveals');
  await page.evaluate(() => { HTMLElement.prototype.scrollIntoView = window.originalReveal; });
  await input.pressSequentially(' works', { delay: 20 });
  assert.equal(await input.inputValue(), 'Next draft works');
  await page.getByRole('button', { name: closeLabel, exact: true }).click();
  await reopen();
  await input.fill('Reopened');
  assert.ok(await input.evaluate(el => el === document.activeElement));
  await page.getByRole('button', { name: closeLabel, exact: true }).click();
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['callbreak', 'marriage', 'flush']) {
      const snapshot = JSON.parse(fs.readFileSync(`/tmp/bhidne-social-${kind}.json`));
      const room = { room_id: 'room', name: 'Chat room', members: ['u0', 'u1'], connected_members: ['u0', 'u1'] };
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
      await context.addInitScript(({ room, kind, site }) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: kind })), { room, kind, site });
      const history = [], roomHistory = [], gameplay = [], errors = [];
      await context.route(site + '/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/' || path.startsWith('/_expo/') || path.startsWith('/assets/') || path === '/favicon.ico') return route.continue();
        let data = [];
        if (path === '/rooms') data = [room];
        if (path === '/rooms/room/chat') {
          if (route.request().method() === 'POST') roomHistory.push({ id: String(roomHistory.length), sender_id: 'u0', sender_name: 'Host', text: route.request().postDataJSON().text, sent_at: Date.now() });
          data = route.request().method() === 'POST' ? roomHistory.at(-1) : roomHistory;
        }
        if (path.startsWith('/test-games/')) { data = snapshot; if (route.request().method() === 'POST') gameplay.push(path); }
        await route.fulfill({ json: data });
      });
      await context.routeWebSocket(site.replace(/^http/, 'ws') + '/**', ws => {
        ws.send(JSON.stringify({ type: 'CONNECTED' }));
        ws.onMessage(raw => {
          const command = JSON.parse(raw);
          if (command.type === 'HEARTBEAT') return ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }));
          const ack = { type: 'TABLE_SOCIAL_ACK', room_id: 'room', match_id: snapshot.match_id, command_id: command.command_id, status: 'accepted' };
          if (command.type === 'TABLE_CHAT_HISTORY') ack.messages = history;
          if (command.type === 'TABLE_CHAT_SEND') {
            const message = { type: 'TABLE_CHAT_MESSAGE', id: command.command_id, room_id: 'room', match_id: snapshot.match_id, sender_id: 'u0', sender_name: 'Host', text: command.payload.text, sent_at: Date.now() };
            history.push(message); ws.send(JSON.stringify(message)); ack.message = message;
          }
          ws.send(JSON.stringify(ack));
        });
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(site);
      const button = name => page.getByRole('button', { name, exact: true });
      if (kind === 'flush') {
        await button('Room chat').click();
        await exerciseChat(page, 'Room chat', 'Send chat message', 'room-chat-history', 'Close room panel', () => button('Room chat').click());
      }
      await page.getByRole('button', { name: /Return to table/ }).first().click();
      for (const [role, phase] of [['seated', 'OPEN'], ['seated', 'LOCKED'], ['seated', 'STARTED'], ['seated', 'COMPLETED'], ['queued', 'LOCKED'], ['queued', 'STARTED'], ['spectator', 'LOCKED'], ['spectator', 'STARTED']]) {
        snapshot.table.phase = phase;
        snapshot.table.current_user.is_seated = role === 'seated';
        snapshot.table.current_user.is_queued = role === 'queued';
        snapshot.your_player_id = role === 'seated' ? 1 : null;
        await page.waitForTimeout(1200);
        assert.equal(await button('Share table').count(), 0, 'sharing is hidden outside the menu');
        assert.equal(await button('Copy table code').count(), 0);
        await button('Table menu').click();
        if (role === 'seated' && ['LOCKED', 'STARTED'].includes(phase)) {
          assert.equal(await button('Share table').count(), 0, `seated players cannot share while ${phase}`);
          await button('Close table menu').click();
          continue;
        }
        await button('Share table').click();
        await button('Copy table code').click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `t-room:${snapshot.match_id}`);
        await button('Copy table link').click();
        const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
        assert.equal(link.searchParams.get('match'), snapshot.match_id);
        await button('Share table invitation').waitFor();
        if (role === 'seated' && phase === 'OPEN') {
          snapshot.table.phase = 'LOCKED';
          await button('Close table sharing').waitFor({ state: 'hidden' });
          assert.equal(await button('Copy table code').count(), 0, 'locking dismisses an already open sharing sheet');
        } else await button('Close table sharing').click();
        await button('Close table menu').click();
      }
      snapshot.table.phase = 'STARTED'; snapshot.table.current_user.is_seated = true; snapshot.your_player_id = 1;
      await page.waitForTimeout(1200);
      await button('Table menu').click();
      await page.getByTestId(kind + '-menu-drawer').getByRole('button', { name: 'Table Chat', exact: true }).click();
      await exerciseChat(page, 'Table message', 'Send table message', 'table-chat-messages', 'Close table chat', () => button('Table Chat').click());
      assert.equal(history.length, 4);
      assert.deepEqual(gameplay, [], 'chat and sharing must not submit gameplay actions');
      assert.deepEqual(errors, []);
      await context.close(); console.log(`PASS ${kind}: menu-only sharing for all roles, repeated chat sends, keyboard scrolling, close/reopen, focus`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
