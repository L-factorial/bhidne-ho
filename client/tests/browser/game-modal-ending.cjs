// Run a legacy Expo web export with EXPO_PUBLIC_API_URL=TEST_WEB_URL and
// EXPO_PUBLIC_RUNTIME_MODE=legacy. All API/WebSocket data is intercepted locally.
// This checks functional cleanup; UIKit modal/touch behavior still needs iPhone testing.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = (process.env.TEST_WEB_URL || 'http://127.0.0.1:8099').replace(/\/$/, '');
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(site).hostname), 'Use a disposable localhost web export.');

const players = [
  { user_id: 'u0', player_id: 1, username: 'sigma', display_name: 'Sigma', connected: true },
  { user_id: 'u1', player_id: 2, username: 'ekraj', display_name: 'Ekraj', connected: true },
];
const room = { room_id: 'ui-modal-ending', name: 'Sigma room', creator_id: 'u0',
  members: players.map(player => player.user_id), connected_members: players.map(player => player.user_id) };

function snapshot(userId, matchId = 'waiting-callbreak', name = 'Waiting Call Break', ended = false) {
  const seat = players.find(player => player.user_id === userId).player_id;
  const current_user = { is_seated: !ended, seat_id: ended ? null : seat, is_queued: false,
    queue_position: null, can_join: false, can_queue: false, can_lock: false, can_start: false,
    can_next_match: false, can_leave_seat: !ended, can_abandon_match: false,
    can_invite_replacement: false, replacement_offer: null };
  const seats = players.map(player => ({ seat_id: player.player_id, user_id: player.user_id, display_name: player.display_name }));
  return { room_id: room.room_id, match_id: matchId, table_id: matchId, table_name: name,
    game_type: 'callbreak', status: ended ? 'ended' : 'waiting', capacity: 4, players,
    your_player_id: ended ? null : seat, is_creator: userId === 'u0', ready: false,
    can_join: false, chat_enabled: !ended, can_create_new_game: ended,
    settings: { weak_hand_enabled: true, no_spades_enabled: true, payments: [0, 0, 0, 0] },
    table: { table_id: matchId, phase: ended ? 'ENDED' : 'OPEN', min_players: 4, max_players: 4,
      requires_explicit_lock: false, requires_replacement: false,
      seated_players: seats, queue: [], released_seats: [], current_user },
    tables: ended ? [] : [{ match_id: matchId, name, game_type: 'callbreak', status: 'waiting',
      phase: 'OPEN', players: 2, capacity: 4, seated_players: seats, current_user }] };
}

async function fixture(browser, userId) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const state = { current: snapshot(userId), endCalls: 0, creationCalls: 0, failNextEnd: false };
  const errors = [], external = [];
  await context.addInitScript(({ site, room, userId }) => {
    localStorage.setItem('bhidne.language', 'en');
    sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: { user_id: userId, token: 'fixture-token' }, room, game: 'callbreak' }));
  }, { site, room, userId });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== site) { external.push(url.origin); return route.abort(); }
    const path = url.pathname;
    if (path === '/' || path.startsWith('/_expo/') || path.startsWith('/assets/') || path === '/favicon.ico') return route.continue();
    let body = [];
    if (path === '/rooms') body = [room];
    else if (path === `/rooms/${room.room_id}`) body = { ...room, is_member: true };
    else if (path === `/rooms/${room.room_id}/members`) body = players;
    else if (path === '/auth/me' || path === '/me') body = players.find(player => player.user_id === userId);
    else if (path === '/friends') body = { friends: [], incoming: [], outgoing: [] };
    else if (path === '/me/community-rules') body = { version: 'fixture-rules', accepted: true, rules: [] };
    else if (path.startsWith(`/test-games/${room.room_id}`)) {
      if (path.endsWith('/end')) {
        state.endCalls++;
        if (state.failNextEnd) {
          state.failNextEnd = false;
          return route.fulfill({ status: 503, json: { detail: 'Fixture end failed. Please retry.' } });
        }
        state.current = snapshot(userId, state.current.match_id, state.current.table_name, true);
      } else if (path === `/test-games/${room.room_id}` && route.request().method() === 'POST') {
        state.creationCalls++;
        state.current = snapshot(userId, `replacement-${state.creationCalls}`, route.request().postDataJSON().name);
      }
      body = state.current;
    }
    await route.fulfill({ json: body });
  });
  await context.routeWebSocket(site.replace(/^http/, 'ws') + '/**', ws => {
    ws.send(JSON.stringify({ type: 'CONNECTED' }));
    ws.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.type === 'HEARTBEAT') return ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }));
      if (message.type === 'TABLE_CHAT_HISTORY') ws.send(JSON.stringify({ type: 'TABLE_SOCIAL_ACK',
        room_id: room.room_id, match_id: state.current.match_id,
        command_id: message.command_id, status: 'accepted', messages: [] }));
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(site);
  await page.getByRole('button', { name: 'Return to table · Waiting Call Break', exact: true }).tap();
  await page.getByTestId('live-game-overlay').waitFor();
  await page.getByTestId('pregame-table').waitFor();
  return { page, context, state, errors, external };
}

async function openMenu(page) {
  const drawer = page.getByTestId('callbreak-menu-drawer');
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Table menu', exact: true }).tap();
  await drawer.waitFor();
  return drawer;
}

async function roomRemainsTappable(page) {
  await page.getByTestId('live-game-overlay').waitFor({ state: 'hidden' });
  await page.getByTestId('callbreak-menu-drawer').waitFor({ state: 'hidden' });
  await page.getByTestId('table-chat-panel').waitFor({ state: 'hidden' });
  await page.getByTestId('room-empty-tables').waitFor();
  const toolbar = page.getByTestId('room-toolbar');
  await toolbar.getByRole('button', { name: 'Room members', exact: true }).tap();
  await page.getByRole('heading', { name: 'Members · 2', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close room panel', exact: true }).tap();
  await page.getByRole('button', { name: 'Create table', exact: true }).tap();
  await page.getByRole('textbox', { name: 'Table name', exact: true }).fill('Another Call Break');
  await page.getByRole('button', { name: 'Create this table', exact: true }).tap();
  await page.getByTestId('live-game-overlay').waitFor();
  await page.getByTestId('callbreak-header').getByText('Another Call Break', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'End game for everyone', exact: true }).waitFor({ state: 'hidden' });
}

(async () => {
  const browser = await (process.env.TEST_BROWSER === 'webkit' ? webkit.launch({ headless: true })
    : chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true }));
  try {
    const owner = await fixture(browser, 'u0');
    try {
      const { page, state } = owner;
      assert.equal(await page.getByRole('button', { name: 'Start game', exact: true }).isDisabled(), true, 'two seated players cannot start a four-player Call Break game');
      let drawer = await openMenu(page);
      await drawer.getByRole('button', { name: 'End game', exact: true }).tap();
      await page.getByRole('button', { name: 'Keep playing', exact: true }).tap();
      assert.equal(state.endCalls, 0, 'cancel must not submit an end command');
      assert.equal(await page.getByTestId('live-game-overlay').isVisible(), true);
      drawer = await openMenu(page);
      await drawer.getByRole('button', { name: 'End game', exact: true }).tap();
      state.failNextEnd = true;
      await page.getByRole('button', { name: 'End game for everyone', exact: true }).tap();
      await page.getByRole('button', { name: 'End game for everyone', exact: true }).waitFor({ state: 'hidden' });
      if (await drawer.isVisible()) {
        await page.getByRole('button', { name: 'Close table menu', exact: true }).tap();
        await drawer.waitFor({ state: 'hidden' });
      }
      await page.getByText('We cannot connect right now. Please check back shortly.', { exact: true }).first().waitFor();
      assert.equal(state.endCalls, 1);
      assert.equal(state.current.status, 'waiting', 'failed end retains the live table');
      drawer = await openMenu(page);
      await drawer.getByRole('button', { name: 'End game', exact: true }).tap();
      await page.getByRole('button', { name: 'End game for everyone', exact: true }).tap();
      await roomRemainsTappable(page);
      assert.equal(state.endCalls, 2);
      assert.equal(state.creationCalls, 1);
      assert.deepEqual(owner.errors, []);
      assert.deepEqual(owner.external, [], 'all requests stay on the local fixture');
      console.log('PASS creator: waiting with two seats, cancel, end failure/retry, room controls and new-table reentry');
    } catch (error) {
      console.error('Creator fixture state:', owner.state);
      console.error('Creator page:', await owner.page.locator('body').innerText());
      console.error('Creator browser errors:', owner.errors);
      throw error;
    } finally { await owner.context.close(); }

    for (const panel of ['menu', 'table chat']) {
      const guest = await fixture(browser, 'u1');
      try {
        const drawer = await openMenu(guest.page);
        if (panel === 'table chat') {
          await drawer.getByRole('button', { name: 'Table Chat', exact: true }).tap();
          await guest.page.getByTestId('table-chat-panel').waitFor();
          await guest.page.getByRole('textbox', { name: 'Table message', exact: true }).fill('Unsent draft');
        }
        guest.state.current = snapshot('u1', guest.state.current.match_id, guest.state.current.table_name, true);
        await roomRemainsTappable(guest.page);
        assert.equal(guest.state.endCalls, 0, 'remote end must not issue a local end command');
        assert.equal(guest.state.creationCalls, 1);
        assert.deepEqual(guest.errors, []);
        assert.deepEqual(guest.external, []);
        console.log(`PASS remote end with ${panel} open: room controls and new-table reentry`);
      } finally { await guest.context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
