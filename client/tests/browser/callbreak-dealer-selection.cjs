const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/private/tmp/bhidne-deletion-browser-tools/node_modules/playwright');
const origin = process.env.TEST_SITE || 'http://127.0.0.1:8099';
const fixtureDir = process.env.FIXTURE_DIR || '/private/tmp/bhidne-dealer-fixtures';

async function player(browser, count, actor, width, state) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const room = { room_id: 'room', name: 'Draw table', creator_id: 'u0', members: Array.from({ length: count + 1 }, (_, i) => 'u' + i) };
  const snapshot = () => JSON.parse(fs.readFileSync(path.join(fixtureDir, `${count}-${state.step}-${actor}.json`)));
  await context.addInitScript(({ origin, actor, room }) => {
    localStorage.setItem('bhidne.language', 'en');
    sessionStorage.setItem('bhidne.session.v1:' + origin, JSON.stringify({ session: { user_id: actor, token: 'mock' }, room, game: 'callbreak' }));
  }, { origin, actor, room });
  page.on('pageerror', error => errors.push(error.message));
  await context.route(origin + '/**', async route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    if (p === '/' || p.startsWith('/assets/') || p.startsWith('/_expo/') || p === '/favicon.ico') return route.continue();
    let body = [];
    if (p === '/auth/me' || p === '/me/profile') body = { user_id: actor, username: actor, display_name: actor };
    else if (p === '/me/community-rules') body = { accepted: true, version: '2026-10-01', muted_until: null };
    else if (p === '/friends') body = { friends: [], incoming: [], outgoing: [], online_friend_ids: [] };
    else if (p === '/rooms') body = [room];
    else if (p === '/rooms/room' || p === '/rooms/room/enter') body = { ...room, is_member: true };
    else if (p === '/test-games/room/action') {
      const action = request.postDataJSON();
      assert.equal(actor, 'u' + state.step);
      assert.equal(action.command, 'PICK_DEALER_CARD');
      assert.deepEqual(action.payload, { position: state.step });
      assert.equal(action.expected_revision, snapshot().game.revision);
      state.actions.push(action); state.step++;
      body = { ...snapshot(), action_ack: { command_id: action.command_id, status: 'accepted', revision: snapshot().game.revision } };
    } else if (p.startsWith('/test-games/room')) body = snapshot();
    await route.fulfill({ json: body });
  });
  await context.routeWebSocket(origin.replace(/^http/, 'ws') + '/**', ws => {
    ws.send(JSON.stringify({ type: 'CONNECTED' }));
    ws.onMessage(raw => { const c = JSON.parse(raw); ws.send(JSON.stringify(c.type === 'HEARTBEAT' ? { type: 'HEARTBEAT_ACK' } : { type: 'TABLE_SOCIAL_ACK', room_id: 'room', match_id: snapshot().match_id, command_id: c.command_id, status: 'accepted', messages: [] })); });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: /Return to table|Watch/ }).first().click();
  await page.getByTestId('callbreak-dealer-selection').waitFor();
  return { context, page, errors };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1280]) for (const count of [4, 5]) {
      const state = { step: 0, actions: [] }, players = [];
      for (let i = 0; i <= count; i++) players.push(await player(browser, count, 'u' + i, width, state));
      for (let step = 0; step < count; step++) {
        if (step > 0) for (const p of players) await p.page.getByTestId(`dealer-pick-${step}`).waitFor();
        const current = players[step].page;
        await current.getByTestId(`dealer-card-${step}`).waitFor();
        await current.getByText('Your turn · Pick a card below', { exact: true }).waitFor();
        assert.equal(await current.getByTestId('dealer-selection-deck').getByRole('button').count(), 52 - step);
        for (let i = 0; i <= count; i++) if (i !== step) assert.ok(await players[i].page.getByTestId(`dealer-card-${step}`).isDisabled());
        await current.getByTestId(`dealer-card-${step}`).click();
        if (step + 1 < count) {
          await current.getByTestId(`dealer-pick-${step + 1}`).waitFor();
          // Reconnect while the draw is unfinished: preserve revealed picks and next turn.
          await players[step + 1].page.reload();
          await players[step + 1].page.getByRole('button', { name: /Return to table/ }).first().click();
          await players[step + 1].page.getByTestId(`dealer-pick-${step + 1}`).waitFor();
        }
      }
      for (const p of players) await p.page.getByText('Player 4 drew the lowest card and deals first.', { exact: true }).waitFor();
      assert.equal(state.actions.length, count);
      assert.ok(await players[3].page.getByRole('button', { name: 'Shuffle deck', exact: true }).isEnabled());
      assert.equal(await players[count].page.getByRole('button', { name: 'Shuffle deck', exact: true }).count(), 0);
      assert.deepEqual(players.flatMap(p => p.errors), []);
      for (const p of players) await p.context.close();
      console.log(`PASS ${count} players at ${width}px: turn permissions, reveal, reconnect, last-picker tie and selected dealer.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
