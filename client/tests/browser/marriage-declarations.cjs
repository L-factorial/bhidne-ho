// Deterministic declaration controls; engine legality is covered in Python tests.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const room = { room_id: 'marriage-declarations', name: 'Marriage declarations', members: ['u0', 'u1', 'u2', 'u3', 'u4'] };
    await context.addInitScript(room => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',
      JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: 'marriage' })), room);
    const pairs = Array.from({ length: 7 }, (_, i) => ({ meld_type: 'dublee', card_ids: [`D0:${i + 2}H`, `D1:${i + 2}H`] }));
    const hand = [...pairs.flatMap(g => g.card_ids), ...Array.from({ length: 7 }, (_, i) => `D0:${i + 2}S`)].map(card_id => ({
      card_id, card_type: 'standard', rank: Number(card_id.slice(3, -1)), suit: card_id.slice(-1), deck_index: Number(card_id[1]) }));
    let revision = 1, qualified = false, finished = false;
    const commands = [];
    const scoring = { tiplu: [3,8,15], jhiplu: [2,5,10], poplu: [2,5,10], man: [2,5,10], marriage: [10,25,50],
      tunnela_bonus: 5, tunnela_scope: 'shown', maal_requires_seen: true, seen_payment: 3, unseen_payment: 10, dublee_win_bonus: 5 };
    const scores = { winner: '1', rules: scoring, total_maal: 0, players: ['1','2','3','4','5'].map(player_id => ({
      player_id, has_seen_maal: player_id === '1', eligible: player_id === '1', items: [], maal_points: 0, maal_net: 0,
      winner_payment: player_id === '1' ? 60 : -15, net_points: player_id === '1' ? 60 : -15 })) };
    function snapshot() {
      const pub = { scoring_rules: scoring, scores: finished ? scores : null, revision, status: finished ? 'finished' : 'active', current_player_id: finished ? null : '1', phase: 'must_discard', stock_count: 115,
        top_discard: hand[20], winner: finished ? '1' : null, players: ['1', '2', '3', '4', '5'].map(player_id => ({ player_id, hand_count: 21,
          route: player_id === '1' && qualified ? 'dublee' : 'unqualified', shown_melds: player_id === '1' && qualified ? pairs : [],
          has_seen_maal: player_id === '1' && qualified, finished: player_id === '1' && finished })) };
      return { room_id: room.room_id, match_id: 'm1', game_type: 'marriage', capacity: 5, ready: true, is_creator: true, can_join: false,
        players: room.members.map((user_id, i) => ({ user_id, player_id: i + 1, display_name: `Player ${i + 1}` })), your_player_id: 1,
        status: finished ? 'finished' : 'playing', game: { revision, phase: 'MUST_DISCARD', finished, winners: finished ? [1] : [], turn: { player_id: 1 }, current_trick: null, scores_tenths: [] },
        marriage: { public: pub, private: { player_id: '1', hand, actions: { kinds: finished ? [] : qualified ? ['finish'] : ['show_dublees'], drawable_sources: [], discardable_card_ids: [], blocked_sources: [] },
          maal: qualified ? { tiplu: { rank: 8, suit: 'C' }, jhiplu: { rank: 7, suit: 'C' }, poplu: { rank: 9, suit: 'C' } } : null } } };
    }
    await context.route('http://localhost:8000/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let body = path === '/rooms' ? [room] : [];
      if (path.startsWith('/test-games/')) {
        if (path.endsWith('/action')) {
          const request = route.request().postDataJSON(); commands.push(request);
          assert.equal(request.expected_revision, revision);
          if (request.command === 'SHOW_DUBLEES') { assert.deepEqual(request.payload, { pairs }); qualified = true; }
          else { assert.equal(request.command, 'FINISH'); finished = true; }
          revision++;
          body = { ...snapshot(), action_ack: { match_id: 'm1', command_id: request.command_id, status: 'accepted', revision } };
        } else body = snapshot();
      }
      await route.fulfill({ json: body });
    });
    await context.routeWebSocket('ws://localhost:8000/**', ws => { ws.send(JSON.stringify({ type: 'CONNECTED' })); ws.onMessage(() => ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }))); });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8081');
    await page.getByTestId('marriage-player-grid').waitFor();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByTestId('marriage-player-grid').waitFor();
    const grid = await page.getByTestId('marriage-player-grid').boundingBox();
    const seats = await page.locator('[data-testid^="marriage-player-"]').evaluateAll(nodes => nodes.filter(n => /marriage-player-[1-5]$/.test(n.dataset.testid)).map(n => {
      const r = n.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height };
    }));
    assert.equal(seats.length, 5);
    for (let i = 0; i < seats.length; i++) {
      const a = seats[i];
      assert.ok(a.x >= grid.x - 1 && a.x + a.width <= grid.x + grid.width + 1);
      for (const b of seats.slice(i + 1)) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'player tiles overlap');
    }
    await page.getByRole('button', { name: 'Points', exact: true }).click();
    await page.getByTestId('marriage-points').getByText('Points appear here when the round finishes, using the saved scoring rules.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await page.getByRole('button', { name: 'Stats', exact: true }).click();
    await page.getByTestId('marriage-details').getByText('Player 5', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await page.screenshot({ path: '../.venv/dev/marriage-five-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId('marriage-player-grid').waitFor();
    await page.getByRole('button', { name: 'Reveal all cards', exact: true }).click();
    await page.getByText('Hidden until your melds qualify.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Arc', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Review seven Dublees', exact: true }).click();
    await page.getByTestId('marriage-meld-preview').waitFor();
    assert.equal(await page.getByTestId('marriage-meld-preview').getByLabel('2♥ · 1', { exact: true }).count(), 1);
    assert.equal(await page.getByTestId('marriage-shown-melds').count(), 0);
    await page.getByTestId('marriage-meld-preview').getByRole('button', { name: 'Show seven Dublees', exact: true }).click();
    await page.getByTestId('marriage-meld-preview').waitFor({ state: 'hidden' });
    await page.getByTestId('marriage-shown-melds').getByText('Player 1 showed seven Dublees', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('marriage-shown-melds').getByLabel('2♥ · 1', { exact: true }).count(), 1);
    await page.getByTestId('marriage-shown-melds').waitFor({ state: 'hidden', timeout: 6000 });
    await page.waitForTimeout(1200); // unchanged polls must not replay the declaration
    assert.equal(await page.getByTestId('marriage-shown-melds').count(), 0);
    await page.getByText('Tiplu 8♣ · Jhiplu 7♣ · Poplu 9♣', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('marriage-maal-spot').getAttribute('aria-label'), 'Maal Tiplu 8♣');
    await page.getByRole('button', { name: 'Hide cards', exact: true }).click();
    assert.equal(await page.getByTestId('marriage-maal-spot').getAttribute('aria-label'), 'Maal hidden');
    await page.getByRole('button', { name: 'Show cards', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '2♥ · 1 grouped', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Arc', exact: true }).click();
    await page.getByRole('button', { name: 'Finish round', exact: true }).click();
    await page.getByText('Player 1 wins!', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Points', exact: true }).click();
    await page.getByTestId('marriage-points').getByText('Player 1: +60 points', { exact: true }).waitFor();
    await page.getByTestId('marriage-points').getByText('Player 5: -15 points', { exact: true }).waitFor();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: '../.venv/dev/marriage-points-mobile.png' });
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    assert.deepEqual(commands.map(c => c.command), ['SHOW_DUBLEES', 'FINISH']);
    assert.deepEqual(errors, []);
    console.log('PASS: seven-pair payload, qualified private Maal, committed-card lock, finish, and winner UI.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
