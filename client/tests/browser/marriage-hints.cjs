const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://localhost:8083';
const button = (page, name) => page.getByRole('button', { name, exact: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
    const room = { room_id: 'marriage-hints', name: 'Marriage hints', members: ['u0', 'u1'] };
    await context.addInitScript(room => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',
      JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: 'marriage' })), room);
    const hand = ['D0:2H', 'D1:2H', 'D0:3H', 'D0:4H', ...Array.from({ length: 13 }, (_, i) => `D0:${i + 2 <= 10 ? i + 2 : ['J', 'Q', 'K', 'A'][i - 9]}S`),
      'D0:2C', 'D0:4C', 'D0:6C', 'MAN:0'].map(card_id => ({ card_id, card_type: card_id.startsWith('MAN') ? 'man' : 'standard',
        rank: card_id.startsWith('MAN') ? null : ({ J: 11, Q: 12, K: 13, A: 14 }[card_id.slice(3, -1)] || Number(card_id.slice(3, -1))),
        suit: card_id.startsWith('MAN') ? null : card_id.slice(-1), deck_index: card_id.startsWith('MAN') ? null : Number(card_id[1]) }));
    const snapshot = { room_id: room.room_id, match_id: 'hints-1', game_type: 'marriage', capacity: 2, is_creator: true, can_join: false,
      players: room.members.map((user_id, i) => ({ user_id, player_id: i + 1, display_name: `Player ${i + 1}`, connected: true })), your_player_id: 1,
      status: 'playing', game: { revision: 1, phase: 'MUST_DRAW', finished: false, winners: [], turn: { player_id: 1 }, current_trick: null, scores_tenths: [] },
      marriage: { public: { revision: 1, status: 'in_progress', current_player_id: '1', phase: 'must_draw', stock_count: 117, top_discard: null, winner: null,
        players: ['1', '2'].map(player_id => ({ player_id, hand_count: 21, route: 'unqualified', shown_melds: [], has_seen_maal: false, finished: false })) },
        private: { player_id: '1', hand, actions: { kinds: ['draw'], drawable_sources: ['stock'], discardable_card_ids: [], blocked_sources: [] }, maal: null } } };
    const commands = [];
    await context.route('http://localhost:8000/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/action')) {
        const command = route.request().postDataJSON(); commands.push(command);
        snapshot.marriage.public.players[0].route = 'normal';
        snapshot.marriage.public.players[0].shown_melds = command.payload.melds;
        snapshot.marriage.public.players[0].has_seen_maal = true;
        snapshot.marriage.private.maal = { tiplu: { rank: 8, suit: 'D' }, jhiplu: { rank: 7, suit: 'D' }, poplu: { rank: 9, suit: 'D' } };
        snapshot.game.revision++;
        snapshot.marriage.public.revision = snapshot.game.revision;
        snapshot.action_ack = { command_id: command.command_id, status: 'accepted', revision: snapshot.game.revision };
      }
      await route.fulfill({ json: path.startsWith('/test-games/') ? snapshot : path === '/rooms' ? [room] : [] });
    });
    await context.routeWebSocket('ws://localhost:8000/**', ws => {
      ws.send(JSON.stringify({ type: 'CONNECTED' })); ws.onMessage(() => ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' })));
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(site);
    await button(page, 'Expand your card area').waitFor();
    const hints = page.getByTestId('marriage-meld-hints');
    assert.equal(await hints.count(), 0, 'unrevealed cards do not leak suggestions');
    await button(page, 'Reveal all cards').click();
    await button(page, 'Hand tools').click();
    await button(page, 'Select cards for meld').click();
    const manualCards = page.getByTestId('marriage-hand').getByRole('button');
    await manualCards.nth(0).click();
    await manualCards.nth(1).click();
    assert.equal(await page.getByTestId('marriage-hand').locator('[aria-pressed="true"]').count(), 2, 'explicit meld selection permits multiple cards');
    await button(page, 'Done selecting meld').click();
    await manualCards.nth(0).click();
    await manualCards.nth(1).click();
    assert.equal(await page.getByTestId('marriage-hand').locator('[aria-pressed="true"]').count(), 1, 'ordinary selection returns to one card');
    await manualCards.nth(1).click();
    await button(page, 'Collapse your card area').click();
    await hints.waitFor();
    const cue = hints.getByTestId('action-cue'), samples = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await cue.evaluate(el => Number(getComputedStyle(el).opacity)));
      await page.waitForTimeout(200);
    }
    assert.ok(Math.max(...samples) - Math.min(...samples) > 0.03, 'available groups pulse with the hand collapsed');
    await hints.click();
    const dialog = page.getByTestId('marriage-hints-dialog');
    await dialog.getByRole('button', { name: /^Select Dublee/ }).click();
    await button(page, 'Collapse your card area').waitFor();
    assert.equal(await page.getByTestId('marriage-hand').locator('[aria-pressed="true"]').count(), 2, 'selecting a Dublee highlights exactly its two physical cards');
    await button(page, 'Stage selected Dublee').click();
    assert.equal(await button(page, 'Review declaration').isDisabled(), true, 'one pair cannot be shown as a full qualification');
    assert.match(await hints.innerText(), /0 Dublees/, 'staged pairs are excluded from suggestions');
    await button(page, 'Remove staged Dublee 1').click();
    assert.match(await hints.innerText(), /1 Dublees/, 'unstaging restores the suggestion without discarding cards');
    await button(page, 'Hide cards').click();
    assert.equal(await hints.count(), 0, 'hidden cards hide the awareness cue');
    await button(page, 'Show cards').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    assert.equal(await cue.evaluate(el => Number(getComputedStyle(el).opacity)), 1, 'reduced motion stops pulsing');
    await page.setViewportSize({ width: 1280, height: 900 });
    await hints.waitFor();
    assert.equal(await hints.count(), 1, 'desktop has a single cue');
    assert.deepEqual(commands, [], 'review and selection never send game commands');
    snapshot.marriage.public.phase = 'must_discard';
    snapshot.marriage.public.players[0].hand_count = 22;
    snapshot.marriage.private.hand.push({ card_id: 'D0:8C', card_type: 'standard', rank: 8, suit: 'C', deck_index: 0 });
    snapshot.marriage.private.actions.kinds = ['show_initial_melds'];
    for (const first of [2, 5, 8]) {
      await hints.click();
      await dialog.getByRole('button', { name: `Select sequence · ${first}♠ · 1, ${first + 1}♠ · 1, ${first + 2}♠ · 1`, exact: true }).click();
      await button(page, 'Stage selected meld').click();
    }
    await button(page, 'Review declaration').click();
    const preview = page.getByTestId('marriage-meld-preview');
    await preview.getByRole('button', { name: 'Show three melds', exact: true }).click();
    await preview.waitFor({ state: 'hidden' });
    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, 'SHOW_INITIAL_MELDS');
    assert.deepEqual(commands[0].payload.melds, [2, 5, 8].map(first => ({ meld_type: 'pure_sequence',
      card_ids: [first, first + 1, first + 2].map(rank => `D0:${rank}S`) })));
    assert.deepEqual(errors, []);
    console.log('PASS Marriage hints: partial groups, pulse, collapsed access, selection/staging/show, privacy, reduced motion and desktop');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
