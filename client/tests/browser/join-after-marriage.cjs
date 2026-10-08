// Serve a legacy web export; API fixtures exercise the shared RoomGameControl UI.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/private/tmp/bhidne-deletion-browser-tools/node_modules/playwright');
const views = require('../fixtures/join-after-marriage.json');
const origin = process.env.TEST_SITE || 'http://127.0.0.1:8103';
const oldMatch = views.completedMarriage.match_id;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1280]) for (const listed of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(), errors = [];
      const room = { room_id: 'room', name: 'Shared room', creator_id: 'u0', members: ['u0', 'u1'] };
      let left = false, joined = false, joinAttempts = 0, leaveAttempts = 0;
      const snapshot = (old = false) => {
        const view = structuredClone(old ? views.completedMarriage : joined ? views.after : views.before);
        view.tables = structuredClone((joined ? views.after : views.before).tables);
        if (listed && !left) view.tables.push(views.completedMarriage.tables[0]);
        return view;
      };
      await context.addInitScript(({ origin, room }) => {
        localStorage.setItem('bhidne.language', 'en');
        sessionStorage.setItem('bhidne.session.v1:' + origin, JSON.stringify({ session: { user_id: 'u1', token: 'mock' }, room, game: 'flush' }));
      }, { origin, room });
      page.on('pageerror', error => errors.push(error.message));
      await context.route(origin + '/**', async route => {
        const request = route.request(), p = new URL(request.url()).pathname;
        if (p === '/' || p.startsWith('/assets/') || p.startsWith('/_expo/') || p === '/favicon.ico') return route.continue();
        let body = [];
        if (p === '/auth/me' || p === '/me/profile') body = { user_id: 'u1', username: 'sigma', display_name: 'Sigma' };
        else if (p === '/me/community-rules') body = { accepted: true, version: '2026-10-01', muted_until: null };
        else if (p === '/friends') body = { friends: [], incoming: [], outgoing: [], online_friend_ids: [] };
        else if (p === '/rooms') body = [room];
        else if (p === '/rooms/room' || p === '/rooms/room/enter') body = { ...room, is_member: true };
        else if (p === '/test-games/room/join') {
          joinAttempts++;
          assert.equal(request.postDataJSON().match_id, views.before.match_id);
          if (!left) return route.fulfill({ status: 409, json: { detail: {
            code: 'PLAYER_ALREADY_AT_TABLE', detail: 'A player is already seated at another table.',
            room_id: 'room', match_id: oldMatch, departure_command: 'leave', requires_leave_game: true,
          } } });
          joined = true; body = snapshot();
        } else if (p === '/test-games/room/leave') {
          assert.equal(request.postDataJSON().match_id, oldMatch);
          leaveAttempts++; left = true; body = snapshot();
        } else if (p.startsWith('/test-games/room')) body = snapshot(new URL(request.url()).searchParams.get('match_id') === oldMatch);
        await route.fulfill({ json: body });
      });
      await context.routeWebSocket(origin.replace(/^http/, 'ws') + '/**', ws => {
        ws.send(JSON.stringify({ type: 'CONNECTED' }));
        ws.onMessage(raw => {
          if (JSON.parse(raw).type === 'HEARTBEAT') ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }));
        });
      });
      await page.goto(origin);
      if (listed) {
        await page.getByRole('button', { name: 'Return to table · Table', exact: true }).click();
        await page.getByTestId('live-game-overlay').waitFor();
        await page.getByRole('button', { name: 'Close table announcement', exact: true }).click();
        await page.getByTestId('live-game-overlay').getByRole('button', { name: 'Back to lobby', exact: true }).click();
        await page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
      }
      await page.getByRole('button', { name: 'Take seat · flu', exact: true }).click();
      const prompt = page.getByRole('heading', { name: 'Leave previous table?', exact: true });
      await prompt.waitFor();
      // Completed Marriage is absent from the active list. Polling must not
      // silently dismiss its authoritative server-reported seat reservation.
      await page.waitForTimeout(2500);
      assert.ok(await prompt.isVisible());
      assert.equal(joinAttempts, 1);
      assert.equal(leaveAttempts, 0);
      await page.getByRole('button', { name: 'Leave previous table', exact: true }).click();
      await prompt.waitFor({ state: 'hidden' });
      assert.equal(leaveAttempts, 1);
      await page.getByRole('button', { name: 'Take seat · flu', exact: true }).click();
      await page.getByTestId('flush-table').waitFor();
      assert.equal(joinAttempts, 2);
      assert.ok(joined);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px (${listed ? 'reserved Marriage visible and returnable' : 'old lobby omits Marriage'}): prompt persists, explicit departure, then Flush join.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
