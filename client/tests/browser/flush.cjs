// Real two-session Flush rules/start/play flow. Requires backend:8000 and Expo:8081.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = 'http://localhost:8000';
async function api(route, user, body) {
  const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: {
    'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const users = await Promise.all([api('/auth/guest', null, {}), api('/auth/guest', null, {})]);
    const room = await api('/rooms', users[0], { name: `Flush browser ${Date.now()}` });
    const pages = [], errors = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: i ? { width: 1280, height: 900 } : { width: 360, height: 800 } });
      await context.addInitScript(({ user, room }) => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',
        JSON.stringify({ session: user, room, game: 'flush' })), { user: users[i], room });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://localhost:8081'); pages.push(page);
    }
    const [one, two] = pages;
    await one.getByRole('button', { name: 'Create a table', exact: true }).click();
    await one.getByRole('button', { name: 'Create table', exact: true }).click();
    await one.getByRole('button', { name: 'Create Flush table', exact: true }).click();
    await one.getByTestId('flush-table').waitFor();
    assert.ok(await one.getByRole('button', { name: 'Lock table', exact: true }).isDisabled());
    await one.getByRole('button', { name: 'Rules', exact: true }).click();
    await one.getByLabel('Blind bet', {exact:true}).fill('10');
    await one.getByLabel('Personal bets before side-show', { exact: true }).fill('1');
    await one.getByLabel('Personal blind bets before show', { exact: true }).fill('1');
    await one.getByRole('button', { name: 'Save Flush rules', exact: true }).click();
    await one.getByText('Everyone can review these saved rules. They lock when the creator starts.', { exact: true }).waitFor();
    const root = `/test-games/${room.room_id}`;
    const saved = await api(root, users[0]);
    assert.equal(saved.flush_settings.rules_revision, 1);
    await one.getByRole('button', { name: 'Close Flush rules', exact: true }).click();
    await one.getByRole('button', { name: 'Collapse table', exact: true }).click();
    await two.getByRole('button', { name: 'View table', exact: true }).click();
    await two.getByRole('button', { name: 'Join table', exact: true }).click();
    await two.getByTestId('flush-table').waitFor();
    assert.equal(await two.getByRole('button', { name: 'Save Flush rules', exact: true }).count(), 0);
    await two.getByRole('button', { name: 'Rules', exact: true }).click();
    assert.equal(await two.getByLabel('Personal bets before side-show', { exact: true }).inputValue(), '1');
    await two.getByRole('button', { name: 'Close Flush rules', exact: true }).click();
    await one.getByRole('button', { name: 'Go back to table', exact: true }).click();
    await one.getByRole('button', { name: 'Lock table', exact: true }).click();
    let preparation = await api(root, users[0]);
    const dealer = preparation.game.turn.player_id - 1;
    await pages[dealer].getByRole('button', {name:'Deal cards',exact:true}).click();
    const cutter = (dealer + 1) % pages.length;
    await pages[cutter].getByRole('button', {name:'Skip cut',exact:true}).click();

    await one.getByRole('button', { name: 'Rules', exact: true }).click();
    await one.getByText('Rules locked for this game', { exact: true }).waitFor();
    assert.equal(await one.getByLabel('Blind bet', { exact: true }).isEditable(), false);
    await one.getByRole('button', { name: 'Close Flush rules', exact: true }).click();
    let state = await api(root, users[0]);
    const first = state.game.turn.player_id - 1, second = 1 - first;
    for (const i of [first, second]) {
      const button = pages[i].getByRole('button', { name: i === first ? 'Bet double · 20 chips' : 'Bet minimum · 20 chips', exact: true });
      await button.click();
      await pages[i].getByText('Blind · See cards when eligible', { exact: true }).waitFor();
    }
    await pages[first].getByRole('button', { name: 'See cards', exact: true }).click();
    const peek = pages[first].getByRole('button', {name:'Peek at all three cards',exact:true});
    await peek.click();
    assert.equal(await pages[first].getByRole('button', {name:/^Your card [123]:/}).count(), 3);
    assert.equal(await pages[second].getByRole('button', {name:/^Your card [123]:/}).count(), 0);
    await pages[first].getByRole('button', {name:'Hide all three cards',exact:true}).click();
    assert.equal(await pages[first].getByRole('button', {name:/^Your card [123]:/}).count(), 0);
    await peek.click();
    assert.equal(await pages[first].getByRole('button', {name:/^Your card [123]:/}).count(), 3);
    assert.equal(await pages[first].getByRole('button', {name:/^(Show|Hide) my cards$/}).count(), 0);
    await pages[first].reload();
    await pages[first].getByRole('button', {name:'Peek at all three cards',exact:true}).waitFor();
    const spectatorUser = await api('/auth/guest', null, {});
    const spectatorContext = await browser.newContext({viewport:{width:1280,height:900}});
    await spectatorContext.addInitScript(({user,room}) => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',
      JSON.stringify({session:user,room,game:'flush'})), {user:spectatorUser,room});
    const spectator = await spectatorContext.newPage();
    await spectator.goto('http://localhost:8081');
    await spectator.getByRole('button', {name:'Join a table',exact:true}).click();
    await spectator.getByRole('button', {name:'Watch table',exact:true}).click();
    await spectator.getByTestId('flush-table').waitFor();
    await pages[first].getByRole('button', { name: 'Show · 40 chips', exact: true }).click();
    for (const page of [...pages, spectator]) {
      await page.getByTestId('flush-final-show').waitFor();
      assert.equal(await page.getByTestId('flush-final-show').getByRole('button', {name:/shown card [123]:/}).count(), 3);
      assert.equal(await page.getByTestId('flush-round-result').count(), 0);
      assert.equal(await page.getByRole('button', {name:'Lock table',exact:true}).count(), 0);
    }
    await pages[second].getByRole('button', {name:'Close final show',exact:true}).click();
    await pages[second].getByTestId('flush-show-overlay').waitFor({state:'hidden'});
    assert.ok((await api(root, users[0])).flush.public.pending_show);
    await pages[second].getByRole('button', {name:'View final show',exact:true}).click();
    await pages[second].getByTestId('flush-show-overlay').waitFor();
    await pages[second].reload();
    await pages[second].getByRole('button', {name:'Reveal cards',exact:true}).click();
    for (const page of pages) await page.getByText(/^Winner:/).waitFor();
    for (const page of [...pages,spectator]) {
      const result = page.getByTestId('flush-round-result');
      await result.waitFor();
      assert.equal(await result.getByRole('button', {name:/card [123]:/}).count(), 6);
      assert.equal(await result.getByRole('button', {name:/^Flip /}).count(), 0);
    }
    await pages[second].reload();
    await pages[second].getByTestId('flush-round-result').waitFor();
    assert.equal(await pages[second].getByTestId('flush-round-result').getByRole('button', {name:/card [123]:/}).count(), 6);
    state = await api(root, users[0]);
    assert.equal(state.status, 'playing');
    assert.equal(state.flush.public.status, 'finished');
    assert.equal(state.flush.public.pot, 90);
    assert.equal(state.flush.public.settlement.shown_hands.length, 2);
    for (const page of [...pages, spectator]) await page.getByRole('button', {name:'Close final show',exact:true}).click();
    const winner = Number(state.flush.public.next_dealer_id) - 1;
    assert.equal(await pages[1].getByRole('button', {name:'Lock table',exact:true}).count(), 0);
    await pages[winner].getByRole('button', {name:'Bet',exact:true}).click();
    const grid = pages[winner].getByTestId('flush-bet-grid');
    assert.ok((await grid.innerText()).includes('Round 1'));
    assert.ok((await grid.innerText()).includes('+'));
    assert.ok((await grid.innerText()).includes('−') || (await grid.innerText()).includes('-'));
    await pages[winner].getByRole('button', {name:'Close Bet',exact:true}).click();
    await pages[0].getByRole('button', {name:'Leave table',exact:true}).click();
    await pages[1].getByRole('button', {name:'Lock table',exact:true}).waitFor();
    assert.ok(await pages[1].getByRole('button', {name:'Lock table',exact:true}).isDisabled());
    const joinSection = pages[0].getByRole('button', {name:'Join a table',exact:true});
    if (await joinSection.getAttribute('aria-expanded') !== 'true') await joinSection.click();
    await pages[0].getByRole('button', {name:'Join table',exact:true}).click();
    await pages[1].getByRole('button', {name:'Lock table',exact:true}).click();
    await pages[winner].getByRole('button', {name:'Deal cards',exact:true}).waitFor();
    await pages[winner].reload();
    await pages[winner].getByRole('button', {name:'Deal cards',exact:true}).click();
    await pages[1 - winner].getByRole('button', {name:'Skip cut',exact:true}).click();
    await pages[1 - winner].getByRole('button', {name:'Bet minimum · 10 chips',exact:true}).waitFor();
    state = await api(root, users[0]);
    assert.equal(state.match_id, preparation.match_id);
    assert.equal(state.flush.public.round_number, 2);
    assert.equal(state.flush.public.round_results.length, 1);
    assert.equal(state.flush.bets.length, 0);
    await api(root+'/end', users[1], {match_id:state.match_id});
    assert.deepEqual(errors, []);
    console.log('Flush browser passed: mobile/desktop rules, locking, blind bets, seeing, reconnect, show.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
