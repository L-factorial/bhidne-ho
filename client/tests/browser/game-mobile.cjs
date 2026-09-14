const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://localhost:8083';
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function api(path, user, body) {
  const r = await fetch('http://localhost:8000' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
}
async function pulse(locator) {
  await locator.waitFor(); const values = [];
  for (let i = 0; i < 5; i++) { values.push(await locator.evaluate(el => Number(getComputedStyle(el).opacity))); await new Promise(r => setTimeout(r, 250)); }
  assert.ok(Math.max(...values) - Math.min(...values) > 0.03, 'control pulses');
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['marriage', 'callbreak']) {
      if (process.env.TEST_GAME && process.env.TEST_GAME !== kind) continue;
      const users = await Promise.all(Array.from({ length: 4 }, (_, i) => api('/auth/guest', null, { display_name: `${kind} ${i}` })));
      const room = await api('/rooms', users[0], { name: `${kind} mobile ${Date.now()}` });
      for (const user of users) await api(`/rooms/${room.room_id}/enter`, user, {});
      const root = `/test-games/${room.room_id}`, game = await api(root, users[0], { game_type: kind, player_count: users.length });
      for (const user of users.slice(1)) await api(root + '/join', user, { match_id: game.match_id });
      const pages = [], contexts = [], errors = [];
      async function stateWhen(predicate) {
        for (let i = 0; i < 150; i++) { const value = await api(root, users[0]); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 200)); }
        throw new Error(`${kind}: timed out waiting for state`);
      }
      for (const [i, user] of users.entries()) {
        const context = await browser.newContext({ viewport: { width: i ? 390 : 360, height: i ? 844 : 740 } }); contexts.push(context);
        await context.addInitScript(({ user, room, kind }) => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000', JSON.stringify({ session: user, room, game: kind })), { user, room, kind });
        const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message));
        await page.goto(site); await page.getByTestId(`${kind}-header`).waitFor();
        const overlay = page.getByTestId('live-game-overlay');
        assert.equal(await overlay.getByRole('button', { name: 'Profile', exact: true }).count(), 0);
        assert.equal(await overlay.getByRole('button', { name: 'Copy game link', exact: true }).count(), 0);
        assert.equal(await button(page, 'Back to room').count(), 0);
      }
      const owner = pages[0], cue = owner.getByTestId(`${kind}-center-start`);
      await pulse(cue.getByTestId('action-cue'));
      assert.equal(await pages[1].getByTestId(`${kind}-center-start`).count(), 0);
      await button(owner, 'Table menu').click(); await button(owner, 'Back to room').waitFor();
      await button(owner, 'End game').waitFor(); await button(owner, 'Table menu').click();
      if (kind === 'marriage') { await cue.getByRole('button', { name: 'Lock game', exact: true }).click(); }
      await cue.getByRole('button', { name: 'Start game', exact: true }).click();
      let state = await stateWhen(s => s.status === 'playing');
      if (kind === 'callbreak') {
        for (const [phase, label] of [['AWAITING_SHUFFLE', 'Shuffle deck'], ['AWAITING_CUT', 'Cut in half'], ['AWAITING_DISTRIBUTION', 'Deal cards']]) {
          state = await stateWhen(s => s.game.phase === phase);
          const actor = pages[state.game.turn.player_id - 1], preparation = actor.getByTestId('callbreak-center-preparation');
          await pulse(preparation.getByRole('button', { name: label, exact: true }).getByTestId('action-cue'));
          await button(actor, label).click();
        }
        await stateWhen(s => s.game.phase === 'HAND_REVIEW');
        for (const page of pages) {
          await button(page, 'Collapse your cards').waitFor();
          await button(page, 'Flip all cards').click();
          await button(page, 'Collapse your cards').click();
          await page.waitForTimeout(1100); assert.equal(await button(page, 'Expand your cards').isVisible(), true);
          await button(page, 'Expand your cards').click();
          assert.equal(await button(page, 'Flip all cards').count(), 0, 'reveal state survives collapse');
          await button(page, 'Accept hand').click();
        }
        for (let i = 0; i < users.length; i++) {
          state = await stateWhen(s => s.game.phase === 'BIDDING' && s.deal.players.filter(p => p.bid !== null).length === i);
          await button(pages[state.game.turn.player_id - 1], 'Confirm bid').click();
        }
        state = await stateWhen(s => s.game.phase === 'PLAYING');
      } else {
        for (const page of pages) {
          await button(page, 'Expand your cards').waitFor();
          await button(page, 'Reveal all cards').click();
        }
      }
      state = await api(root, users[0]);
      const actorIndex = Number(kind === 'marriage' ? state.marriage.public.current_player_id : state.game.turn.player_id) - 1;
      const actor = pages[actorIndex];
      await button(actor, 'Collapse your cards').waitFor();
      const dock = actor.getByTestId(`${kind}-hand-dock`);
      await dock.getByRole('button', { name: 'Poke the table', exact: true }).waitFor();
      await button(actor, 'Table menu').click();
      assert.equal(await actor.getByTestId(`${kind}-menu`).getByRole('button', { name: /Poke/ }).count(), 0);
      await button(actor, 'Table menu').click();
      if (kind === 'marriage') {
        await button(actor, 'Hide cards').click();
        await button(actor, 'Collapse your cards').click();
        const prompt = await actor.getByTestId('your-turn-pulse').boundingBox();
        const collapsed = await button(actor, 'Expand your cards').boundingBox();
        assert.ok(prompt.y + prompt.height <= collapsed.y, 'turn prompt sits above collapsed cards');
        assert.ok(collapsed.y - (prompt.y + prompt.height) <= 12, 'turn prompt is directly above cards');
        const stock = actor.getByRole('button', { name: /^Take stock / });
        await stock.click({ trial: true });
        await actor.screenshot({ path: process.env.TEMP + '/marriage-mobile-draw.png' });
        await actor.getByRole('button', { name: /^Take stock / }).click();
        await stateWhen(s => s.marriage.public.phase === 'must_discard');
        await button(actor, 'Collapse your cards').waitFor();
        await button(actor, 'Show cards').click();
        await actor.getByTestId('marriage-hand').getByRole('button').first().click();
      } else {
        await actor.getByRole('radio', { name: 'Card grid view', exact: true }).click();
        const own = await api(root, users[actorIndex]);
        const legal = own.private.legal_cards[0];
        await actor.getByTestId('player-hand').getByRole('button', { name: `Select ${legal}`, exact: true }).click();
      }
      const play = () => kind === 'marriage' ? actor.getByRole('button', { name: /^Discard / }) : actor.getByRole('button', { name: /^Play / });
      await actor.route('**/test-games/*/action', route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Test rejected action' }) }));
      await play().click(); await dock.getByText('Test rejected action', { exact: true }).waitFor();
      await button(actor, 'Collapse your cards').waitFor();
      await actor.unroute('**/test-games/*/action');
      if (kind === 'callbreak') {
        const own = await api(root, users[actorIndex]);
        await actor.getByTestId('player-hand').getByRole('button', { name: `Select ${own.private.legal_cards[0]}`, exact: true }).click();
      }
      await play().click(); await button(actor, 'Expand your cards').waitFor();
      await actor.getByTestId('chat-dock').waitFor({ state: 'hidden' });
      await actor.screenshot({ path: process.env.TEMP + `/${kind}-mobile-collapsed.png` });
      await button(actor, 'Expand your cards').click(); await actor.screenshot({ path: process.env.TEMP + `/${kind}-mobile-expanded.png` });
      if (kind === 'marriage') {
        const card = await actor.getByTestId('marriage-hand').getByRole('button').first().boundingBox();
        assert.ok(card.width >= 30, 'Marriage cards retain their width after collapsing');
      }
      await actor.setViewportSize({ width: 1280, height: 900 });
      await actor.getByTestId(`${kind}-mobile-hand`).waitFor({ state: 'hidden' });
      await dock.waitFor();
      assert.equal(await actor.getByTestId('live-game-overlay').getByRole('button', { name: 'Profile', exact: true }).count(), 0);
      assert.equal(await actor.getByTestId('game-footer').getByRole('button', { name: 'Copy game link', exact: true }).count(), 1);
      // Use the real match shape to exercise completion/replacement controls
      // without playing all five Call Break deals or engineering a Marriage win.
      const base = await api(root, users[0]);
      let stage = kind === 'callbreak' ? 'review' : 'finished';
      const transitions = [];
      function completionSnapshot() {
        const value = structuredClone(base);
        value.table.current_user.can_lock = false;
        value.table.current_user.can_start = false;
        value.table.current_user.can_next_match = false;
        if (stage === 'review') {
          value.game.phase = 'DEAL_COMPLETE'; value.game.current_trick = null;
          value.round_review = { deal_number: value.deal.deal_number, can_continue: true };
        } else if (stage === 'finished') {
          value.status = 'finished'; value.game.finished = true; value.game.winners = [1]; value.game.current_trick = null;
          value.table.phase = 'COMPLETED'; value.table.current_user.can_next_match = true;
          if (kind === 'marriage') { value.marriage.public.status = 'finished'; value.marriage.public.winner = '1'; value.marriage.public.current_player_id = null; }
        } else if (stage === 'open' || stage === 'locked') {
          value.match_id += '-next'; value.status = 'waiting';
          delete value.game; delete value.deal; delete value.private; delete value.marriage; delete value.round_review;
          value.table.phase = stage === 'open' ? 'OPEN' : 'LOCKED';
          value.table.current_user.can_lock = kind === 'marriage' && stage === 'open';
          value.table.current_user.can_start = kind === 'callbreak' || stage === 'locked';
        }
        return value;
      }
      await owner.route(`**${root}**`, async route => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() === 'POST') {
          transitions.push(path.slice(root.length));
          if (path.endsWith('/next-deal')) stage = 'finished';
          else if (path.endsWith('/table/next-match')) stage = 'open';
          else if (path.endsWith('/table/lock')) stage = 'locked';
          else if (path.endsWith('/start')) stage = 'started';
        }
        await route.fulfill({ json: completionSnapshot() });
      });
      await owner.setViewportSize({ width: 360, height: 740 }); await owner.reload();
      if (kind === 'callbreak') {
        const nextDeal = owner.getByTestId('callbreak-center-next-deal');
        await pulse(nextDeal.getByTestId('action-cue')); await nextDeal.getByRole('button').click();
      }
      const restart = owner.getByTestId(`${kind}-center-start`);
      await pulse(restart.getByTestId('action-cue'));
      await restart.getByRole('button', { name: 'Prepare next match', exact: true }).click();
      if (kind === 'marriage') await restart.getByRole('button', { name: 'Lock game', exact: true }).click();
      await restart.getByRole('button', { name: 'Start game', exact: true }).click();
      await restart.waitFor({ state: 'hidden' });
      assert.deepEqual(transitions, kind === 'marriage' ? ['/table/next-match', '/table/lock', '/start'] : ['/next-deal', '/table/next-match', '/start']);
      assert.deepEqual(errors, []);
      for (const context of contexts) await context.close();
      console.log(`PASS ${kind}: setup, header, card panel, action rejection/acceptance, pokes, paused chat and desktop resize`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
