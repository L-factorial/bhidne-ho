const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
async function api(route, user, body) {
  const r = await fetch('http://localhost:8000' + route, { method: body ? 'POST' : 'GET', headers: {
    'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const users = await Promise.all(Array.from({length:3}, () => api('/auth/guest', null, {})));
    const room = await api('/rooms', users[0], { name: `Flush sides ${Date.now()}` });
    const root = `/test-games/${room.room_id}`, pages = [], errors = [];
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ viewport: i ? { width:1280, height:900 } : { width:360,height:800 } });
      await context.addInitScript(({user,room}) => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000', JSON.stringify({session:user,room,game:'flush'})), {user:users[i],room});
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://localhost:8081'); pages.push(page);
    }
    const owner = pages[0];
    await owner.getByRole('button', {name:'Create a table',exact:true}).click();
    await owner.getByRole('button', {name:'Create table',exact:true}).click();
    await owner.getByRole('button', {name:'Create Flush table',exact:true}).click();
    await owner.getByRole('button', {name:'Rules',exact:true}).click();
    await owner.getByLabel('Blind bet', {exact:true}).fill('10');
    await owner.getByLabel('Personal bets before side-show', {exact:true}).fill('0');
    await owner.getByRole('button', {name:'Allow private side-show: No',exact:true}).click();
    await owner.getByRole('button', {name:'Save Flush rules',exact:true}).click();
    await owner.getByText('Everyone can review these saved rules. They lock when the creator starts.', {exact:true}).waitFor();
    await owner.getByRole('button', {name:'Close Flush rules',exact:true}).click();
    for (const page of pages.slice(1)) {
      await page.getByRole('button', {name:'View table',exact:true}).click();
      await page.getByRole('button', {name:'Join table',exact:true}).click();
      await page.getByTestId('flush-table').waitFor();
    }
    await owner.getByRole('button', {name:'Lock table',exact:true}).click();
    let preparation = await api(root, users[0]);
    const dealer = preparation.game.turn.player_id - 1;
    await pages[dealer].getByRole('button', {name:'Deal cards',exact:true}).click();
    const cutter = (dealer + 1) % pages.length;
    await pages[cutter].getByRole('button', {name:'Cut in half',exact:true}).waitFor();
    await pages[cutter].reload();
    await pages[cutter].getByRole('button', {name:'Cut in half',exact:true}).waitFor();
    for (const page of pages) {
      const name = page.getByTestId(`flush-turn-name-${cutter + 1}`);
      await name.waitFor();
      const values = new Set();
      for (let n = 0; n < 5; n++) {
        values.add(await name.evaluate(el => getComputedStyle(el).opacity));
        await page.waitForTimeout(150);
      }
      assert.ok(values.size > 1, 'Active player name pulses for every viewer');
    }
    await pages[cutter].getByRole('button', {name:'Cut in half',exact:true}).click();

    await owner.getByTestId('flush-arena').waitFor();
    let state = await api(root, users[0]);
    const first = state.game.turn.player_id - 1;
    for (let offset = 0; offset < 3; offset++) {
      const i = (first + offset) % 3, page = pages[i];
      await page.getByRole('button', {name:'See cards',exact:true}).click();
      await page.getByRole('button', {name:'Peek at all three cards',exact:true}).click();
      assert.equal(await page.getByRole('button', {name:/^Your card \d:/}).count(), 3);
      await page.getByRole('button', {name:'Bet minimum · 20 chips',exact:true}).click();
      await page.getByTestId('flush-coin-flight').waitFor();
      await page.getByTestId('flush-coin-flight').waitFor({state:'hidden'});
    }
    await owner.getByRole('button', {name:'Bet',exact:true}).click();
    await owner.getByTestId('flush-bet-grid').waitFor();
    assert.ok((await owner.getByTestId('flush-bet-grid').innerText()).includes('Total'));
    await owner.getByRole('button', {name:'Close Bet',exact:true}).click();
    const dock = await owner.getByTestId('flush-hand-dock').boundingBox();
    for (const seat of ['1','2','3']) { const box = await owner.getByTestId(`flush-seat-${seat}`).boundingBox(); assert.ok(box.y + box.height <= dock.y, 'Every player marker fits above the hand dock'); }
    await owner.screenshot({path:'/tmp/flush-ellipse-mobile.png'});
    await pages[1].screenshot({path:'/tmp/flush-ellipse-desktop.png'});
    await pages[first].getByRole('button', {name:'Request side-show',exact:true}).click();
    state = await api(root, users[0]);
    // Wait on the response UI; API polling may precede the action's request cycle.
    const target = (first + 2) % 3, observer = (first + 1) % 3;
    await pages[target].getByRole('button', {name:'Accept side-show',exact:true}).click();
    for (const page of pages) {
      await page.getByTestId('flush-fold-notice').waitFor();
      assert.match(await page.getByTestId('flush-fold-notice').innerText(), /folded/);
    }
    for (const i of [first,target]) await pages[i].getByTestId('flush-private-comparison').waitFor();
    assert.equal(await pages[observer].getByTestId('flush-private-comparison').count(), 0);
    const outcomes = [];
    for (const i of [first,target]) {
      for (let card = 1; card <= 3; card++) await pages[i].getByRole('button', {name:`Flip opponent card ${card}`,exact:true}).click();
      const outcome = pages[i].getByRole('alert').filter({hasText:/^You (lost|stay)$/});
      await outcome.waitFor(); outcomes.push(await outcome.innerText());
      await pages[i].getByRole('button', {name:'Continue',exact:true}).click();
    }
    assert.deepEqual(outcomes.sort(), ['You lost','You stay']);
    state = await api(root, users[0]);
    assert.equal(state.status, 'playing');
    assert.equal(state.flush.public.players.filter(p=>p.status==='folded').length, 1);
    assert.equal(state.flush.public.pot, 95);
    await pages[first].reload();
    await pages[first].getByTestId('flush-arena').waitFor();
    assert.equal(await pages[first].getByTestId('flush-private-comparison').count(), 0);
    assert.equal(await pages[first].getByTestId('flush-coin-flight').count(), 0);
    assert.deepEqual(errors, []);
    await api(root+'/end',users[0],{match_id:state.match_id});
    console.log('Flush ellipse, coin flights, bet grid, card flips, and private side-show passed.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
