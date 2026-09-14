// Real backend :8000, Expo :8081. Player/viewer chat and unanimous rules.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
async function api(path, user, body) {
  const r = await fetch('http://localhost:8000' + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['callbreak', 'marriage', 'flush']) {
      const count = kind === 'callbreak' ? 4 : 2;
      const users = await Promise.all(Array.from({ length: count + 1 }, (_, i) => api('/auth/guest', null, { display_name: `Friend ${i}` })));
      const room = await api('/rooms', users[0], { name: `Chat rules ${kind} ${Date.now()}` });
      for (const user of users) await api(`/rooms/${room.room_id}/enter`, user, {});
      const root = `/test-games/${room.room_id}`, initial = await api(root, users[0], { game_type: kind, player_count: count });
      const body = { match_id: initial.match_id };
      for (const user of users.slice(1, count)) await api(root + '/join', user, body);
      await api(root + '/table/join-queue', users[count], body);
      const contexts = [], errors = [];
      async function pageFor(user, width) {
        const context = await browser.newContext({ viewport: { width, height: 900 } }); contexts.push(context);
        await context.addInitScript(({ user, room, kind }) => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000', JSON.stringify({ session: user, room, game: kind })), { user, room, kind });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto('http://localhost:8081'); return page;
      }
      const player = await pageFor(users[1], 1280), viewer = await pageFor(users[count], 360);
      const noun = kind === 'flush' ? 'table' : 'game';
      await player.getByRole('button', { name: 'Back to room', exact: true }).waitFor();
      await viewer.getByRole('button', { name: `Join a ${noun}`, exact: true }).click();
      await viewer.getByRole('button', { name: `Watch ${noun}`, exact: true }).click();
      for (const page of [player, viewer]) {
        await page.getByRole('button', { name: 'Room chat', exact: true }).click();
        await page.getByRole('button', { name: 'Close chat', exact: true }).click();
      }
      await api(`/rooms/${room.room_id}/chat`, users[0], { text: 'Hello from Friend 0' });
      await viewer.getByTestId('chat-unread').waitFor();
      await viewer.getByRole('button', { name: 'Room chat', exact: true }).click();
      await viewer.getByText('Hello from Friend 0', { exact: true }).waitFor();
      await viewer.getByRole('button', { name: 'Close chat', exact: true }).click();
      async function propose() {
        if (kind === 'callbreak') return api(root + '/settings', users[0], { ...body, weak_hand_enabled: false });
        if (kind === 'marriage') return api(root + '/marriage-settings', users[0], { ...body, scoring: { ...initial.marriage_scoring, seen_payment: 7 } });
        return api(root + '/flush-settings', users[0], { ...body, rules_revision: 0, starting_chips: 500, rules: { ...initial.flush_settings.rules, initial_blind_bet: 7 } });
      }
      await propose();
      for (const page of [player, viewer]) await page.getByRole('button', { name: 'Review rule change', exact: true }).click();
      assert.equal(await viewer.getByRole('button', { name: 'Accept rules', exact: true }).count(), 0);
      await viewer.getByRole('button', { name: 'Close rule review', exact: true }).click();
      await player.getByRole('button', { name: 'Reject rules', exact: true }).click();
      await player.getByText(/^rejected ·/).waitFor();
      await player.getByRole('button', { name: 'Close rule review', exact: true }).click();
      const proposal = (await propose()).rule_proposal;
      await player.getByText(/proposed rule changes · pending/).waitFor();
      await player.getByRole('button', { name: 'Review rule change', exact: true }).click();
      await player.getByRole('button', { name: 'Accept rules', exact: true }).click();
      for (const user of users.slice(2, count)) await api(root + '/rule-vote', user, { ...body, proposal_id: proposal.id, accept: true });
      await player.getByText(/^accepted · \d\/\d accepted/).waitFor();
      await player.getByRole('button', { name: 'Close rule review', exact: true }).click();
      if (kind !== 'callbreak') await api(root + '/table/lock', users[0], body);
      const current = await api(root, users[0]);
      await api(root + '/start', users[0], { ...body, rules_revision: current.flush_settings?.rules_revision ?? 0 });
      await player.getByText('Room chat · Paused', { exact: true }).waitFor();
      assert.equal(await player.getByRole('button', { name: 'Room chat', exact: true }).isDisabled(), true);
      await viewer.getByRole('button', { name: 'Room chat', exact: true }).click();
      await viewer.getByRole('textbox', { name: 'Room chat message', exact: true }).fill('Still watching');
      await viewer.getByRole('button', { name: 'Send chat message', exact: true }).click();
      await viewer.getByText('Still watching', { exact: true }).waitFor();
      await viewer.getByRole('button', { name: 'Close chat', exact: true }).click();
      assert.deepEqual(errors, []);
      for (const context of contexts) await context.close();
      console.log(`${kind}: chat strip/overlay, spectator access, rejection and unanimous approval passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
