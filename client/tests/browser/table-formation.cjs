// Real backend :8000 and Expo web :8081. No game data is mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
async function api(path, user, body) {
  const response = await fetch('http://localhost:8000' + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json',
      ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(value)}`);
  return value;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    for (const kind of ['callbreak', 'marriage', 'flush']) {
      const capacity = kind === 'callbreak' ? 4 : 3;
      const seated = kind === 'callbreak' ? 4 : 2;
      const users = await Promise.all(Array.from({ length: seated + 1 }, () => api('/auth/guest', null, {})));
      const room = await api('/rooms', users[0], { name: `Formation ${kind} ${Date.now()}` });
      for (const user of users) await api(`/rooms/${room.room_id}/enter`, user, {});
      const root = `/test-games/${room.room_id}`;
      const initial = await api(root, users[0], { game_type: kind, player_count: capacity });
      const body = { match_id: initial.match_id };
      for (const user of users.slice(1, seated)) await api(root + '/join', user, body);
      async function pageFor(user, width) {
        const context = await browser.newContext({ viewport: { width, height: 850 } });
        await context.addInitScript(({ user, room, kind }) => {
          sessionStorage.setItem('bhidne.session.v1:http://localhost:8000', JSON.stringify({ session: user, room, game: kind }));
        }, { user, room, kind });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://localhost:8081');
        return { page, context };
      }
      const host = await pageFor(users[0], 1280);
      if (kind !== 'callbreak') {
        await host.page.getByRole('button', { name: 'Lock game', exact: true }).click();
        const locked = await api(root, users[0]);
        assert.equal(locked.table.phase, 'LOCKED');
        assert.equal(locked.game, undefined);
        await host.page.getByRole('button', { name: 'Start game', exact: true }).click();
        assert.equal((await api(root, users[0])).table.phase, 'STARTED');
      }
      const waiter = await pageFor(users.at(-1), 360);
      await waiter.page.getByRole('button', { name: 'Join waitlist', exact: true }).click();
      await waiter.page.getByText(/Waitlist position 1/).waitFor();
      await waiter.page.reload();
      await waiter.page.getByText(/Waitlist position 1/).waitFor();
      if (kind === 'callbreak') {
        await api(root + '/table/leave-seat', users[1], body);
        await waiter.page.getByRole('button', { name: 'Back to room', exact: true }).waitFor();
        const promoted = await api(root, users.at(-1));
        assert.equal(promoted.your_player_id, 4);
        assert.equal(promoted.table.current_user.is_queued, false);
        assert.equal(promoted.table.phase, 'OPEN');
        await host.page.getByRole('button', { name: 'Start game', exact: true }).click();
        await host.page.getByRole('button', { name: 'Abandon match', exact: true }).click();
        await host.page.getByRole('button', { name: 'Keep playing', exact: true }).click();
        assert.equal((await api(root, users[0])).table.phase, 'STARTED');
      } else {
        await waiter.page.getByRole('button', { name: kind === 'flush' ? 'Join a table' : 'Join a game', exact: true }).click();
        await waiter.page.getByRole('button', { name: kind === 'flush' ? 'Watch table' : 'Watch game', exact: true }).click();
        const watched = await api(root, users.at(-1));
        assert.equal(watched[kind].private, null);
        await waiter.page.getByRole('button', { name: 'Back to room', exact: true }).click();
        await waiter.page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
        await waiter.page.getByText(/Waitlist position 1/).waitFor();
        await waiter.page.getByRole('button', { name: 'Leave room', exact: true }).click();
        await waiter.page.getByText('LOBBY', { exact: true }).waitFor();
        assert.equal((await api(root, users[0])).table.queue.length, 0);
      }
      await host.context.close(); await waiter.context.close();
      console.log(`${kind}: formation, waitlist, reconnect and membership controls passed`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
