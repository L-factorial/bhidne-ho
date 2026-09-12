// Deterministic declaration controls; engine legality is covered in Python tests.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const room = { room_id: 'marriage-declarations', name: 'Marriage declarations', members: ['u0', 'u1'] };
    await context.addInitScript(room => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',
      JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: 'marriage' })), room);
    const pairs = Array.from({ length: 7 }, (_, i) => ({ meld_type: 'dublee', card_ids: [`D0:${i + 2}H`, `D1:${i + 2}H`] }));
    const hand = [...pairs.flatMap(g => g.card_ids), ...Array.from({ length: 7 }, (_, i) => `D0:${i + 2}S`)].map(card_id => ({
      card_id, card_type: 'standard', rank: Number(card_id.slice(3, -1)), suit: card_id.slice(-1), deck_index: Number(card_id[1]) }));
    let revision = 1, qualified = false, finished = false;
    const commands = [];
    function snapshot() {
      const pub = { revision, status: finished ? 'finished' : 'active', current_player_id: finished ? null : '1', phase: 'must_discard', stock_count: 115,
        top_discard: hand[20], winner: finished ? '1' : null, players: ['1', '2'].map(player_id => ({ player_id, hand_count: 21,
          route: player_id === '1' && qualified ? 'dublee' : 'unqualified', shown_melds: player_id === '1' && qualified ? pairs : [],
          has_seen_maal: player_id === '1' && qualified, finished: player_id === '1' && finished })) };
      return { room_id: room.room_id, match_id: 'm1', game_type: 'marriage', capacity: 2, ready: true, is_creator: true, can_join: false,
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
    await page.getByRole('button', { name: 'Reveal all cards', exact: true }).click();
    await page.getByText('Hidden until your melds qualify.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Arc', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Review seven Dublees', exact: true }).click();
    await page.getByRole('button', { name: 'Show seven Dublees', exact: true }).click();
    await page.getByText('Tiplu 8♣ · Jhiplu 7♣ · Poplu 9♣', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '2♥ · 1 grouped', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Arc', exact: true }).click();
    await page.getByRole('button', { name: 'Finish round', exact: true }).click();
    await page.getByText('Player 1 wins!', { exact: true }).waitFor();
    assert.deepEqual(commands.map(c => c.command), ['SHOW_DUBLEES', 'FINISH']);
    assert.deepEqual(errors, []);
    console.log('PASS: seven-pair payload, qualified private Maal, committed-card lock, finish, and winner UI.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
