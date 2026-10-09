// Local exported app and isolated snapshots only; no live accounts or game writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8108';
const fixtures = process.env.FIXTURE_DIR || '/private/tmp/bhidne-stats-fixtures';
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function fixture(browser, kind, count, width, spectator = false, configure) {
  const context = await browser.newContext({ viewport: { width, height: width === 320 ? 740 : width === 390 ? 844 : 900 }, reducedMotion: 'no-preference' });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  let snapshot = JSON.parse(fs.readFileSync(path.join(fixtures, `${kind}-${count}.json`)));
  if (spectator) {
    snapshot.your_player_id = null; snapshot.private = null;
    if (snapshot[kind]) snapshot[kind].private = null;
    snapshot.is_creator = false;
    snapshot.table.current_user = { ...snapshot.table.current_user, is_seated: false, seat_id: null };
  }
  if (kind === 'marriage') {
    // Synthetic public qualification for review; private hands are unchanged.
    const shown = snapshot.marriage.public.players[1];
    shown.route = 'dublee'; shown.has_seen_maal = true;
    shown.shown_melds = Array.from({ length: 7 }, (_, i) => ({ meld_type: 'dublee', card_ids: [`D0:${i + 2}H`, `D1:${i + 2}H`] }));
  }
  configure?.(snapshot);
  const actor = spectator ? 'u4' : 'u0';
  const room = { room_id: 'room', name: 'Stats room', creator_id: 'u0', members: Array.from({ length: count + 1 }, (_, i) => 'u' + i) };
  const errors = [], writes = [];
  await context.addInitScript(({site, actor, room, kind}) => {
    localStorage.setItem('bhidne.language', 'en');
    sessionStorage.setItem('bhidne.session.v1:' + site, JSON.stringify({ session: { user_id: actor, token: 'fixture' }, room, game: kind }));
  }, {site, actor, room, kind});
  page.on('pageerror', error => errors.push(error.message));
  await context.route(site + '/**', async route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    if (p === '/' || p.startsWith('/assets/') || p.startsWith('/_expo/') || p === '/favicon.ico') return route.continue();
    let body = [];
    if (request.method() !== 'GET') writes.push(p);
    if (p === '/auth/me' || p === '/me/profile') body = { user_id: actor, display_name: actor, username: actor };
    else if (p === '/me/community-rules') body = { accepted: true, version: '2026-10-01', muted_until: null };
    else if (p === '/friends') body = { friends: [], incoming: [], outgoing: [], online_friend_ids: [] };
    else if (p === '/rooms') body = [room];
    else if (p === '/rooms/room' || p === '/rooms/room/enter') body = { ...room, is_member: true };
    else if (p.startsWith('/test-games/room')) body = snapshot;
    await route.fulfill({json:body});
  });
  await context.routeWebSocket(site.replace(/^http/,'ws') + '/**', ws => {
    ws.send(JSON.stringify({ type: 'CONNECTED' }));
    ws.onMessage(raw => { const message = JSON.parse(raw); ws.send(JSON.stringify(message.type === 'HEARTBEAT' ? { type: 'HEARTBEAT_ACK' } : { type: 'TABLE_SOCIAL_ACK', room_id: 'room', match_id: snapshot.match_id, command_id: message.command_id, status: 'accepted', messages: [] })); });
  });
  await page.goto(site);
  await page.getByRole('button', {name:/Return to table|Watch/}).first().click();
  await page.getByTestId('game-stats-toggle').waitFor();
  return {page, context, errors, writes, change: update => { snapshot = structuredClone(snapshot); update(snapshot); }, notify: () => {
    snapshot = structuredClone(snapshot); snapshot.game.revision++;
    snapshot.game.turn.player_id = 1;
    if (kind === 'callbreak') { snapshot.game.phase = 'BIDDING'; snapshot.deal.players[0].bid = null; }
    else if (kind === 'marriage') { snapshot.marriage.public.revision++; snapshot.marriage.public.current_player_id = '1'; snapshot.marriage.public.phase = 'must_discard'; snapshot.marriage.private.actions.kinds = ['discard']; }
    else { snapshot.flush.public.current_player_id = '1'; snapshot.flush.public.pending_side_show = { requester_id: '2', target_id: '1', revision: snapshot.game.revision, accepted: false }; snapshot.flush.private.actions.kinds = ['accept_side_show', 'decline_side_show']; }
  }};
}

module.exports = { fixture };

if (require.main === module) (async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const width of (process.env.TEST_WIDTHS || '320,390,1280').split(',').map(Number)) for (const kind of (process.env.TEST_GAMES || 'callbreak,marriage,flush').split(',')) {
      const f = await fixture(browser,kind,4,width), {page} = f;
      await page.getByTestId('game-stats-toggle').click();
      const stats = page.getByTestId('game-stats-overlay'); await stats.waitFor();
      if (kind === 'callbreak') { assert.equal(await stats.getByRole('tab').count(),0); await stats.getByTestId('callbreak-summary').waitFor(); }
      else { assert.equal(await stats.getByRole('tab',{name:'All',exact:true}).getAttribute('aria-selected'),'true'); assert.equal(await stats.getByTestId(/^game-stats-player-/).count(),4); }
      const hand = page.getByTestId('hand-attention-collapsed'); await hand.waitFor();
      await page.screenshot({path:`/private/tmp/bhidne-stats-panel-${kind}-${width}.png`});
      const statsBox = await stats.boundingBox(), handBox = await hand.boundingBox();
      const headerBox = await page.getByTestId(new RegExp(`^${kind}-(mobile-)?header$`)).boundingBox();
      assert.ok(statsBox.y >= headerBox.y + headerBox.height - 1);
      assert.ok(statsBox.y + statsBox.height <= handBox.y + 1, `${kind} stats overlaps the collapsed hand`);
      if (kind !== 'callbreak') {
      await stats.getByRole('tab',{name:'Player 2',exact:true}).click();
      assert.equal(await stats.getByTestId(/^game-stats-player-/).count(),1);
      assert.equal(await stats.getByTestId('game-stats-player-1').count(),0);
      if (kind === 'marriage') { await stats.getByText('Maal seen',{exact:true}).waitFor(); assert.equal(await stats.getByText('Dublee',{exact:true}).count(),7); }
      if (kind === 'flush') { await stats.getByText('Became seen',{exact:false}).first().waitFor(); assert.ok(await stats.getByText(/Bet placed/).count()>0); }
      await stats.getByRole('tab',{name:'All',exact:true}).click();
      assert.ok(await stats.getByTestId('game-stats-content').evaluate(node=>node.scrollHeight>node.clientHeight), `${kind} history should scroll`);
      }
      f.notify();
      await page.waitForTimeout(6000); // Actual room polling refresh, not an injected React state.
      await stats.waitFor(); await hand.waitFor();
      assert.equal(await page.getByTestId('hand-attention-expanded').count(),0);
      const rays = hand.getByTestId('attention-ray-left-0'); await rays.waitFor();
      const opacity=[]; for(let i=0;i<5;i++){opacity.push(await rays.evaluate(node=>Number(getComputedStyle(node.parentElement).opacity)));await page.waitForTimeout(180);}
      assert.ok(Math.max(...opacity)-Math.min(...opacity)>.1, `${kind} collapsed attention should pulse while stats stays open`);
      await hand.click(); await stats.waitFor({state:'hidden'}); await page.getByTestId('hand-attention-expanded').waitFor();
      await page.getByTestId('game-stats-toggle').click(); await stats.waitFor(); await hand.waitFor();
      if (kind !== 'callbreak') assert.equal(await stats.getByRole('tab',{name:'All',exact:true}).getAttribute('aria-selected'),'true');
      await stats.getByTestId('game-stats-close').click(); await stats.waitFor({state:'hidden'}); await hand.waitFor();
      await page.getByRole('button',{name:'Table menu',exact:true}).click();
      const drawer = page.getByTestId(`${kind}-menu-drawer`); await drawer.waitFor();
      assert.ok(await drawer.evaluate(node=>[...node.querySelectorAll('[role="button"]')].every(button=>{const a=button.getBoundingClientRect(),b=node.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1;})), `${kind} drawer controls overflow horizontally`);
      assert.ok(await drawer.evaluate(node=>[...node.querySelectorAll('*')].filter(n=>getComputedStyle(n).overflowY==='auto').every(n=>n.scrollWidth<=n.clientWidth+1)), `${kind} drawer must not require horizontal scrolling`);
      await page.screenshot({path:`/private/tmp/bhidne-stats-drawer-${kind}-${width}.png`});
      await page.getByRole('button',{name:'Close table menu',exact:true}).click();
      assert.deepEqual(f.errors,[]); assert.ok(f.writes.every(p=>!p.endsWith('/action')), 'stats reads must not send game commands');
      console.log(`PASS ${kind} ${width}: tabs, scrolling, mutual exclusion, notifications/pulse and drawer`);
      await f.context.close();
    }
    for (const count of [4,5]) for (const width of (process.env.TEST_WIDTHS || '320,390,1280').split(',').map(Number)) {
      const f=await fixture(browser,'callbreak',count,width),{page}=f;
      const table=page.getByTestId('card-table');await table.waitFor();
      const expandedHand=page.getByTestId('hand-attention-expanded');if(await expandedHand.count())await expandedHand.click();
      await page.getByTestId('callbreak-center-status').getByText(/Round 3 \/ 5.*Hand 4 \/ (13|10)/s).waitFor();
      const cards=await page.getByTestId(/^trick-play-/).evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
      const seats=await page.getByTestId(/^table-seat-/).evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
      assert.equal(cards.length,count-1);
      for(const [i,card] of cards.entries()){assert.ok(seats.every(seat=>!overlap(card,seat)));assert.ok(cards.slice(i+1).every(other=>!overlap(card,other)));}
      assert.equal(await page.getByTestId(/^callbreak-seat-stats-/).count(),count);
      assert.ok(await page.getByTestId(/^callbreak-seat-stats-/).evaluateAll(nodes=>nodes.every(n=>{const seat=n.closest('[data-testid^="table-seat-"]'),a=n.getBoundingClientRect(),b=seat.getBoundingClientRect();return a.bottom<=b.bottom+1&&a.left>=b.left&&a.right<=b.right+1;})), 'bid/won info must stay inside its seat');
      if(count===5&&width===320){
        // Exercise measured row growth as well as the pure fontScale geometry.
        await page.addStyleTag({content:'[data-testid^="callbreak-seat-stats-"] * { font-size:22px !important; line-height:32px !important; }'});
        await page.waitForTimeout(500);
        assert.ok(await page.getByTestId(/^callbreak-seat-stats-/).evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().bottom<=n.closest('[data-testid^="table-seat-"]').getBoundingClientRect().bottom+1)), 'larger stat text must grow its seat');
        const largeCards=await page.getByTestId(/^trick-play-/).evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
        const largeSeats=await page.getByTestId(/^table-seat-/).evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
        assert.ok(largeCards.every(card=>largeSeats.every(seat=>!overlap(card,seat))), 'larger text must not collide with inward cards');
      }
      await page.screenshot({path:`/private/tmp/bhidne-stats-callbreak-${count}-${width}.png`});
      console.log(`PASS Call Break ${count} players ${width}: inward cards and stat rows do not collide`);assert.deepEqual(f.errors,[]);await f.context.close();
    }
    for(const kind of ['callbreak','marriage','flush']){
      const f=await fixture(browser,kind,4,390,true);
      await f.page.getByTestId('game-stats-toggle').click();await f.page.getByTestId('game-stats-overlay').waitFor();
      assert.equal(await f.page.getByTestId('hand-area-header').count(),0);assert.deepEqual(f.errors,[]);
      console.log(`PASS ${kind} spectator: public stats available without private hand`);await f.context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
