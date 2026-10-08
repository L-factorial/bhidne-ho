// Isolated owner flow: a completed table remains open until explicitly closed.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/private/tmp/bhidne-deletion-browser-tools/node_modules/playwright');
const fixtures = require('../fixtures/join-after-marriage.json');
const origin = process.env.TEST_SITE || 'http://127.0.0.1:8103';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(), errors = [];
      const room = { room_id: 'room', name: 'Abc', creator_id: 'u1', members: ['u0', 'u1'] };
      let closed = false, deleted = false, closures = 0;
      const snapshot = () => {
        const v = structuredClone(fixtures.completedMarriage);
        v.status = closed ? 'ended' : 'finished';
        v.can_end_table = !closed; v.is_creator = false; v.your_player_id = null;
        v.marriage.private = null;
        v.table.phase = closed ? 'ENDED' : 'COMPLETED';
        v.table.current_user = { ...v.table.current_user, is_seated: false, seat_id: null, can_leave_seat: false, can_next_match: false };
        v.tables = closed ? [] : [{ ...v.tables[0], name: 'ABC Marriage', can_end_table: true, current_user: v.table.current_user }];
        return v;
      };
      await context.addInitScript(({ origin, room }) => {
        localStorage.setItem('bhidne.language', 'en');
        sessionStorage.setItem('bhidne.session.v1:' + origin, JSON.stringify({ session: { user_id: 'u1', token: 'mock' }, room, game: 'marriage' }));
      }, { origin, room });
      page.on('pageerror', error => errors.push(error.message));
      await context.route(origin + '/**', async route => {
        const r = route.request(), p = new URL(r.url()).pathname;
        if (p === '/' || p.startsWith('/assets/') || p.startsWith('/_expo/') || p === '/favicon.ico') return route.continue();
        let body = [];
        if (p === '/auth/me' || p === '/me/profile') body = { user_id: 'u1', username: 'sigma', display_name: 'Sigma' };
        else if (p === '/me/community-rules') body = { accepted: true, version: '2026-10-01', muted_until: null };
        else if (p === '/friends') body = { friends: [], incoming: [], outgoing: [], online_friend_ids: [] };
        else if (p === '/rooms') body = deleted ? [] : [room];
        else if (p === '/rooms/room' && r.method() === 'DELETE') {
          assert.ok(closed, 'Room must not be deleted before closing its blocking table');
          deleted = true; return route.fulfill({ status: 204 });
        } else if (p === '/rooms/room' || p === '/rooms/room/enter') body = { ...room, is_member: true };
        else if (p === '/test-games/room/end') {
          assert.equal(r.postDataJSON().match_id, fixtures.completedMarriage.match_id);
          closed = true; closures++; body = snapshot();
        } else if (p.startsWith('/test-games/room')) body = snapshot();
        await route.fulfill({ json: body });
      });
      await context.routeWebSocket(origin.replace(/^http/, 'ws') + '/**', ws => {
        ws.send(JSON.stringify({ type: 'CONNECTED' }));
        ws.onMessage(raw => { if (JSON.parse(raw).type === 'HEARTBEAT') ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' })); });
      });
      await page.goto(origin);
      await page.getByRole('button', { name: 'View results · ABC Marriage', exact: true }).click();
      await page.getByRole('button', { name: 'Close table announcement', exact: true }).click();
      await page.getByRole('button', { name: 'Table menu', exact: true }).click();
      await page.getByRole('button', { name: 'End table', exact: true }).click();
      assert.equal(closures, 0);
      await page.getByRole('button', { name: 'End table for everyone', exact: true }).click();
      await page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
      await page.getByTestId('room-empty-tables').waitFor();
      assert.equal(closures, 1);
      await page.getByRole('button', { name: 'More room actions', exact: true }).click();
      await page.getByRole('button', { name: 'Delete room', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm delete room', exact: true }).click();
      await page.waitForFunction(origin => {
        const saved = JSON.parse(sessionStorage.getItem('bhidne.session.v1:' + origin));
        return saved?.room === null;
      }, origin);
      assert.ok(deleted); assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px: nonseated room owner sees completed table, explicitly closes it, then deletes room.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
