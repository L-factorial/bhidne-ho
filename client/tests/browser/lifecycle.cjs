// Real backend :8000 and Expo web :8081. Run all supported game navigation flows.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
async function api(path, user, body) {
  const response = await fetch('http://localhost:8000' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['callbreak', 'marriage', 'flush']) {
      const count = kind === 'callbreak' ? 4 : 2;
      const users = await Promise.all(Array.from({ length: count }, () => api('/auth/guest', null, {})));
      const room = await api('/rooms', users[0], { name: `Lifecycle ${kind} ${Date.now()}` });
      for (const user of users) await api(`/rooms/${room.room_id}/enter`, user, {});
      const root = `/test-games/${room.room_id}`;
      const game = await api(root, users[0], { game_type: kind, player_count: count });
      for (const user of users.slice(1)) await api(root + '/join', user, { match_id: game.match_id });
      if (kind !== 'callbreak') await api(root + '/table/lock', users[0], { match_id: game.match_id });
      const before = await api(root + '/start', users[0], { match_id: game.match_id, rules_revision: 0 });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(({ user, room, kind }) => {
        if (!sessionStorage.getItem('bhidne.session.v1:http://localhost:8000'))
          sessionStorage.setItem('bhidne.session.v1:http://localhost:8000', JSON.stringify({ session: user, room, game: kind }));
      }, { user: users[0], room, kind });
      const page = await context.newPage();
      const mutations = [], errors = [];
      page.on('request', request => { if (request.method() === 'POST') mutations.push(new URL(request.url()).pathname); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://localhost:8081');
      const collapse = page.getByRole('button', { name: kind === 'flush' ? 'Collapse table' : 'Collapse game', exact: true });
      await collapse.click();
      const returning = page.getByRole('button', { name: kind === 'flush' ? 'Go back to table' : 'Go back to game', exact: true });
      await returning.waitFor();
      assert.equal((await api(`/rooms/${room.room_id}`, users[0])).active_game.player_is_participant, true);
      await returning.click();
      await collapse.waitFor();
      await page.reload();
      await collapse.waitFor();
      const after = await api(root, users[0]);
      assert.equal(after.match_id, before.match_id);
      assert.equal(after.your_player_id, before.your_player_id);
      assert.deepEqual(after.game, before.game);
      assert.deepEqual(after.players, before.players);
      assert.deepEqual(mutations.filter(path => path.startsWith(root)), []);
      await collapse.click();
      await page.getByRole('button', { name: 'Leave room', exact: true }).click();
      await page.getByRole('button', { name: kind === 'callbreak' ? 'Abandon match and leave room' : 'Leave game and room', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Stay in room', exact: true }).click();
      assert.equal((await api(`/rooms/${room.room_id}`, users[0])).is_member, true);
      // A waiting seat is released atomically by explicit room departure.
      await api(root + '/end', users[0], { match_id: game.match_id });
      await api(root, users[0], { game_type: kind, player_count: count });
      await page.getByRole('button', { name: 'Leave room', exact: true }).click();
      await page.getByText('YOUR SPACE', { exact: true }).waitFor();
      assert.equal((await api(`/rooms/${room.room_id}`, users[0])).is_member, false);
      assert.equal((await api(`/rooms/${room.room_id}`, users[0])).active_game.player_is_participant, false);
      // Simulate another offline tab with an old saved room; refresh must only resume.
      await page.evaluate(({ user, room, kind }) => sessionStorage.setItem(
        'bhidne.session.v1:http://localhost:8000', JSON.stringify({ session: user, room, game: kind })),
        { user: users[0], room, kind });
      await page.reload();
      await page.getByText('YOUR SPACE', { exact: true }).waitFor();
      assert.equal((await api(`/rooms/${room.room_id}`, users[0])).is_member, false);
      // Intentional room entry is still available and does not seat the player.
      await page.getByRole('button', { name: 'Available rooms', exact: true }).click();
      await page.getByRole('button', { name: `Enter ${room.name}`, exact: true }).click();
      await page.getByText('ROOM LOBBY', { exact: true }).waitFor();
      const entered = await api(`/rooms/${room.room_id}`, users[0]);
      assert.equal(entered.is_member, true);
      assert.equal(entered.active_game.player_is_participant, false);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`${kind}: Back, Return, refresh, and explicit game-then-room departure passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
