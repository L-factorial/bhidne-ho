const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { checkThemes } = require('./theme-check.cjs');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8096';
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function api(path, user, body) {
  const r = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
}
async function stableCue(locator) {
  await locator.waitFor(); const values = [];
  for (let i = 0; i < 5; i++) { values.push(await locator.evaluate(el => Number(getComputedStyle(el).opacity))); await new Promise(r => setTimeout(r, 250)); }
  assert.ok(values.every(value => value === 1), 'action text stays readable without continuous flashing');
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['marriage', 'callbreak']) {
      if (process.env.TEST_GAME && process.env.TEST_GAME !== kind) continue;
      const users = await Promise.all(Array.from({ length: 4 }, (_, i) => api('/auth/signup', null, { username: `${kind}_${Date.now()}_${i}`, password: 'Game-menu-test-123' })));
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
        await context.addInitScript(({ user, room, kind, site }) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: user, room, game: kind })), { user, room, kind, site });
        const page = await context.newPage(); page.setDefaultTimeout(15000); pages.push(page); page.on('pageerror', e => errors.push(e.message));
        await page.goto(site);
        if(i===0) for(const mode of ['dark','light']) {
          await page.getByRole('button',{name:`Switch to ${mode} mode`,exact:true}).click();
          await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);
          await page.screenshot({path:`/tmp/theme-room-${kind}-${mode}.png`});
        }
        await page.getByRole('button',{name:/^Return to table ·/}).click(); await page.getByTestId(`${kind}-header`).waitFor();
        const overlay = page.getByTestId('live-game-overlay');
        assert.equal(await overlay.getByRole('button', { name: 'Profile', exact: true }).count(), 0);
        assert.equal(await overlay.getByRole('button', { name: 'Copy game link', exact: true }).count(), 0);
        assert.equal(await button(page, 'Back to room').count(), 0);
      }
      const owner = pages[0], cue = owner.getByTestId(`${kind}-center-start`);
      await stableCue(cue.getByTestId('action-cue'));
      assert.equal(await pages[1].getByTestId(`${kind}-center-start`).count(), 0);
      await button(owner, 'Table menu').click(); await button(owner, 'Back to room').waitFor();
      await button(owner, 'End game').waitFor(); await button(owner, 'Close table menu').click();
      if (kind === 'marriage') { await cue.getByRole('button', { name: 'Lock game', exact: true }).click(); }
      await cue.getByRole('button', { name: 'Start game', exact: true }).click();
      let state = await stateWhen(s => s.status === 'playing');
      if (kind === 'callbreak') {
        for (const [phase, label] of [['AWAITING_SHUFFLE', 'Shuffle deck'], ['AWAITING_CUT', 'Cut in half'], ['AWAITING_DISTRIBUTION', 'Deal cards']]) {
          state = await stateWhen(s => s.game.phase === phase);
          const actor = pages[state.game.turn.player_id - 1], preparation = actor.getByTestId('callbreak-center-preparation');
          await stableCue(preparation.getByRole('button', { name: label, exact: true }).getByTestId('action-cue'));
          await button(actor, label).click();
        }
        await stateWhen(s => s.game.phase === 'HAND_REVIEW');
        for (const page of pages) {
          assert.equal(await page.getByTestId('callbreak-hand-attention').evaluate(el=>getComputedStyle(el).opacity),'1');
          await button(page, 'Expand your card area').click();
          await button(page, 'Collapse your card area').waitFor();
          await button(page, 'Flip all cards').click();
          await button(page, 'Collapse your card area').click();
          await page.waitForTimeout(1100); assert.equal(await button(page, 'Expand your card area').isVisible(), true);
          await button(page, 'Expand your card area').click();
          assert.equal(await button(page, 'Flip all cards').count(), 0, 'reveal state survives collapse');
          await stableCue(button(page, 'Accept hand').getByTestId('action-cue'));
          await button(page, 'Accept hand').click();
        }
        for (let i = 0; i < users.length; i++) {
          state = await stateWhen(s => s.game.phase === 'BIDDING' && s.deal.players.filter(p => p.bid !== null).length === i);
          const bidder = pages[state.game.turn.player_id - 1];
          await bidder.getByText('Make your call',{exact:true}).waitFor({state:'attached'});
          await button(bidder, 'Expand your card area').click();
          await button(bidder, 'Confirm bid').click();
        }
        state = await stateWhen(s => s.game.phase === 'PLAYING');
      } else {
        for (const page of pages) {
          await button(page, 'Expand your card area').waitFor();
          await button(page, 'Expand your card area').click();
          await button(page, 'Reveal cards').click();
        }
      }
      state = await api(root, users[0]);
      const actorIndex = Number(kind === 'marriage' ? state.marriage.public.current_player_id : state.game.turn.player_id) - 1;
      const actor = pages[actorIndex];
      if (kind === 'callbreak' && await button(actor, 'Expand your card area').isVisible()) assert.equal(await actor.getByTestId('callbreak-hand-attention').evaluate(el=>getComputedStyle(el).opacity),'1');
      if (await button(actor, 'Expand your card area').isVisible()) await button(actor, 'Expand your card area').click();
      await button(actor, 'Collapse your card area').waitFor();
      await checkThemes(actor, `${kind}-turn`);
      const dock = actor.getByTestId(`${kind}-hand-dock`);
      const table=actor.getByTestId(kind==='marriage'?'marriage-play-area':'card-table');
      await actor.emulateMedia({reducedMotion:'reduce'});
      for(const viewport of [{width:390,height:844},{width:1280,height:900}]) {
        await actor.setViewportSize(viewport);await actor.waitForTimeout(350);
        const tableBounds=await table.boundingBox(),handBounds=await dock.boundingBox();
        await table.evaluate(el=>{globalThis.testGameTable=el;});
        await dock.evaluate(el=>{globalThis.testGameHand=el;});
        let newSockets=0;const socketOpened=()=>newSockets++;actor.on('websocket',socketOpened);
        const before=await api(root,users[actorIndex]);
        await button(actor,'Table menu').click();
        const menu=actor.getByTestId(`${kind}-menu-drawer`);await menu.waitFor();
        assert.deepEqual(await table.boundingBox(),tableBounds);
        assert.deepEqual(await dock.boundingBox(),handBounds);
        await button(menu,'Players & waiting queue').click();
        await menu.getByRole('button',{name:/^Poke /}).first().waitFor();
        assert.equal(await menu.getByText(/Your seat /).count(),0);
        await button(menu,'Players & waiting queue').click();
        await button(menu,'Copy Invite Link').waitFor();
        await actor.waitForTimeout(250);await actor.screenshot({path:`/tmp/${kind}-menu-${viewport.width}.png`});
        await actor.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
        assert.equal(await table.evaluate(el=>globalThis.testGameTable===el),true);
        assert.equal(await dock.evaluate(el=>globalThis.testGameHand===el),true);
        assert.equal(newSockets,0);actor.off('websocket',socketOpened);
        const after=await api(root,users[actorIndex]);
        assert.deepEqual(after.game,before.game);
        assert.deepEqual(kind==='marriage'?after.marriage.private:after.private,kind==='marriage'?before.marriage.private:before.private);
      }
      await actor.setViewportSize({width:390,height:844});
      if(await button(actor,'Expand your card area').isVisible()) await button(actor,'Expand your card area').click();
      await button(actor,'Table menu').click();await button(actor.getByTestId(`${kind}-menu-drawer`),'Poke the table').click();
      await button(actor,'Close poke composer').click();
      await button(actor,'Table menu').click();await button(actor.getByTestId(`${kind}-menu-drawer`),'Rules').click();
      if(kind==='callbreak') {
        await actor.getByText('Call Break rules',{exact:true}).waitFor();await button(actor,'Close table menu').click();
      } else {
        await button(actor,'Close details').click();
      }
      await actor.getByTestId(`${kind}-mobile-hand`).waitFor();
      if(await button(actor,'Expand your card area').isVisible()) await button(actor,'Expand your card area').click();
      if (kind === 'marriage') {
        await button(actor, 'Hide cards').click();
        await button(actor, 'Collapse your card area').click();
        const collapsed = await button(actor, 'Expand your card area').boundingBox();
        assert.ok(collapsed.height <= 64, 'collapsed card area remains a compact dock');
        assert.equal(await actor.getByTestId('marriage-hand-header').isVisible(), false, 'collapsed dock hides card controls');
        const stock = actor.getByRole('button', { name: /^Take stock / });
        await stock.click({ trial: true });
        await actor.screenshot({ path: '/tmp' + '/marriage-mobile-draw.png' });
        await actor.getByRole('button', { name: /^Take stock / }).click();
        await stateWhen(s => s.marriage.public.phase === 'must_discard');
        await button(actor, 'Collapse your card area').waitFor();
        await button(actor, 'Show cards').click();
        await actor.getByTestId('marriage-hand').getByRole('button').first().click();
      } else {
        // Switching between desktop and mobile remounts the existing hand wrapper.
        if(await button(actor,'Flip all cards').isVisible()) await button(actor,'Flip all cards').click();
        await actor.getByRole('radio', { name: 'Card grid view', exact: true }).click();
        const own = await api(root, users[actorIndex]);
        const legal = own.private.legal_cards[0];
        await actor.getByTestId('player-hand').getByRole('button', { name: `Select ${legal}`, exact: true }).click();
      }
      const play = () => kind === 'marriage' ? actor.getByRole('button', { name: /^Discard / }) : actor.getByRole('button', { name: /^Play / });
      await actor.route('**/test-games/*/action', route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Test rejected action' }) }));
      await play().click(); await (kind === 'marriage' ? actor.getByTestId('marriage-hand-footer') : dock).getByText('Test rejected action', { exact: true }).waitFor();
      await button(actor, 'Collapse your card area').waitFor();
      await actor.unroute('**/test-games/*/action');
      if (kind === 'callbreak') {
        const own = await api(root, users[actorIndex]);
        await actor.getByTestId('player-hand').getByRole('button', { name: `Select ${own.private.legal_cards[0]}`, exact: true }).click();
      }
      await play().click(); await button(actor, 'Expand your card area').waitFor();
      await actor.getByTestId('chat-dock').waitFor({ state: 'hidden' });
      await checkThemes(actor, `${kind}-waiting`);
      await actor.screenshot({ path: '/tmp' + `/${kind}-mobile-collapsed.png` });
      await button(actor, 'Expand your card area').click(); await actor.screenshot({ path: '/tmp' + `/${kind}-mobile-expanded.png` });
      if (kind === 'marriage') {
        const card = await actor.getByTestId('marriage-hand').getByRole('button').first().boundingBox();
        assert.ok(card.width >= 30, 'Marriage cards retain their width after collapsing');
      }
      await actor.setViewportSize({ width: 1280, height: 900 });
      await actor.getByTestId(`${kind}-mobile-hand`).waitFor({ state: 'hidden' });
      await dock.waitFor();
      assert.equal(await actor.getByTestId('live-game-overlay').getByRole('button', { name: 'Profile', exact: true }).count(), 0);
      assert.equal(await actor.getByTestId('game-footer').getByRole('button', { name: 'Copy game link', exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      for (const context of contexts) await context.close();
      console.log(`PASS ${kind}: setup, header, card panel, action rejection/acceptance, pokes, paused chat and desktop resize`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
