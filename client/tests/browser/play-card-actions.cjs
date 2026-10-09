const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/private/tmp/bhidne-join-regression/browser-tools/node_modules/playwright');
const origin = process.env.TEST_SITE || 'http://127.0.0.1:8103';
const summary = require('../fixtures/join-after-marriage.json').before.tables[0];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage(), errors = [], mutations = [];
      let declined = false;
      const table = (match_id, name, seated = false) => ({ ...summary, match_id, name, room_id: 'room', room_name: 'Room',
        current_user: { ...summary.current_user, is_seated: seated, can_join: !seated } });
      const invitation = (id, match_id, table_name) => ({ id, match_id, table_name, room_id: 'room', room_name: 'Room',
        game_type: 'flush', created_at: 1, seated: 1, capacity: 2, seat_available: true });
      await context.addInitScript(origin => {
        localStorage.setItem('bhidne.language', 'en');
        sessionStorage.setItem('bhidne.session.v1:' + origin, JSON.stringify({ session: { user_id: 'u1', token: 'mock' }, room: null, game: null }));
      }, origin);
      page.on('pageerror', error => errors.push(error.message));
      await context.route(origin + '/**', async route => {
        const r = route.request(), p = new URL(r.url()).pathname;
        if (p === '/' || p.startsWith('/assets/') || p.startsWith('/_expo/') || p === '/favicon.ico') return route.continue();
        let body = [];
        if (r.method() !== 'GET') {
          mutations.push(p);
          assert.equal(p, '/test-games/invitations/invite/decline');
          declined = true; body = {};
        } else if (p === '/auth/me' || p === '/me/profile') body = { user_id: 'u1', username: 'sigma', display_name: 'Sigma' };
        else if (p === '/me/community-rules') body = { accepted: true, version: '2026-10-01', muted_until: null };
        else if (p === '/friends') body = { friends: [], incoming: [], outgoing: [], online_friend_ids: [] };
        else if (p === '/active-tables') body = [table('public', 'Public table'), table('own', 'My table', true)];
        else if (p === '/test-games/invitations') body = [invitation('stale', 'own', 'My table'),
          {...invitation('wait', 'full', 'Full invited table'), seated: 2, seat_available: false, can_queue: true, phase: 'LOCKED'},
          ...(declined ? [] : [invitation('invite', 'invited', 'Invitation table')])];
        await route.fulfill({ json: body });
      });
      await page.goto(origin);
      await page.getByRole('button', { name: 'Join · Public table', exact: true }).waitFor().catch(async error => {
        console.error(await page.locator('body').innerText(), errors);
        throw error;
      });
      assert.equal(await page.getByRole('button', { name: /Discard/ }).count(), 0);
      assert.ok(await page.getByRole('button', { name: 'Return to table · My table', exact: true }).isVisible());
      assert.equal(await page.getByTestId('play-table-public').getByRole('button').count(), 1);
      assert.equal(await page.getByTestId('play-table-own').getByRole('button').count(), 1);
      assert.ok(await page.getByRole('button', { name: 'Wait · Full invited table', exact: true }).isVisible());
      assert.ok(await page.getByRole('button', { name: 'Decline invitation · Full invited table', exact: true }).isVisible());
      assert.ok(await page.getByRole('button', { name: 'Join · Invitation table', exact: true }).isVisible());
      await page.getByRole('button', { name: 'Decline invitation · Invitation table', exact: true }).click();
      await page.getByTestId('play-table-invited').waitFor({ state: 'hidden' });
      assert.ok(await page.getByTestId('play-table-own').isVisible());
      assert.ok(await page.getByTestId('play-table-public').isVisible());
      assert.deepEqual(mutations, ['/test-games/invitations/invite/decline']);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px: Join/Return, no Discard, invitation-only decline, occupied table stays visible.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
