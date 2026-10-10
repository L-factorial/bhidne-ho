// Use a localhost legacy Expo export. Every API/WS request is intercepted;
// these tests never delete real rooms or accounts. UIKit needs the device matrix.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = (process.env.TEST_WEB_URL || 'http://127.0.0.1:8101').replace(/\/$/, '');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(site).hostname));
const user = { user_id: 'fixture-owner', token: 'fixture-token' };
const room = { room_id: 'deletion-fixture', name: 'Deletion fixture', creator_id: user.user_id,
  visibility: 'private', members: [user.user_id], connected_members: [user.user_id] };

async function fixture(browser, inRoom) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const state = { removed: false, roomCalls: 0, accountCalls: 0, failRoom: false,
    displayName: 'Fixture Owner', roomHiddenAtRequest: [], accountHiddenAtRequest: [], signOutCalls: 0 };
  const errors = [], external = [];
  await context.addInitScript(({ site, user, room, inRoom }) => {
    localStorage.setItem('bhidne.language', 'en');
    sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: user, room: inRoom ? room : null, game: null }));
  }, { site, user, room, inRoom });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (url.origin !== site) { external.push(url.origin); return route.abort(); }
    if (path === '/' || path.startsWith('/_expo/') || path.startsWith('/assets/') || path === '/favicon.ico') return route.continue();
    let body = [];
    if (path === `/rooms/${room.room_id}` && method === 'DELETE') {
      state.roomCalls++;
      state.roomHiddenAtRequest.push(!await page.getByRole('button', { name: 'Confirm delete room', exact: true }).isVisible()
        && !await page.getByRole('button', { name: 'Delete room', exact: true }).isVisible());
      if (state.failRoom) { state.failRoom = false; return route.fulfill({ status: 503, json: { detail: 'Fixture deletion failed' } }); }
      state.removed = true;
    } else if (path === '/rooms') body = state.removed ? [] : [room];
    else if (path === `/rooms/${room.room_id}`) body = { ...room, is_member: true };
    else if (path === `/rooms/${room.room_id}/members`) body = [{ ...user, display_name: state.displayName }];
    else if (path === '/auth/me' || path === '/me/profile') {
      if (method === 'PATCH') state.displayName = route.request().postDataJSON().display_name;
      body = { ...user, username: 'fixture_owner', display_name: state.displayName };
    } else if (path === '/friends') body = { friends: [], incoming: [], outgoing: [] };
    else if (path === '/me/community-rules') body = { version: 'fixture-rules', accepted: true, rules: [] };
    else if (path === '/auth/deletion/capabilities') body = { enabled: true };
    else if (path === '/auth/deletion/status') body = { status: 'pending' };
    else if (path === '/auth/deletion/request') {
      state.accountCalls++;
      state.accountHiddenAtRequest.push(!await page.getByTestId('profile-screen').isVisible());
      if (route.request().postDataJSON().current_password !== 'fixture-password') {
        return route.fulfill({ status: 400, json: { detail: { code: 'deletion_invalid_proof' } } });
      }
      body = { status_token: 'fixture-status-token' };
    } else if (path === '/auth/signout') {
      state.signOutCalls++;
      assert.equal(await page.getByTestId('profile-screen').isVisible(), false);
    } else if (path === '/public/policy') body = { ready: true, operator: 'Local fixture', contact: '', minimum_age: null, backups: '' };
    else if (path.startsWith(`/test-games/${room.room_id}`)) body = { room_id: room.room_id, status: 'ended', game_type: 'callbreak',
      players: [], tables: [], is_creator: true, ready: false, can_create_new_game: true };
    await route.fulfill({ json: body });
  });
  await context.routeWebSocket(site.replace(/^http/, 'ws') + '/**', socket => {
    socket.send(JSON.stringify({ type: 'CONNECTED' }));
    socket.onMessage(raw => { if (JSON.parse(raw).type === 'HEARTBEAT') socket.send(JSON.stringify({ type: 'HEARTBEAT_ACK' })); });
  });
  await page.goto(site);
  return { page, context, state, errors, external };
}

async function openProfile(page) {
  await page.getByRole('button', { name: 'Open profile', exact: true }).tap();
  await page.getByTestId('profile-screen').waitFor();
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const owner = await fixture(browser, true);
    try {
      const { page, state } = owner;
      const more = () => page.getByRole('button', { name: 'More room actions', exact: true }).tap();
      await more();
      await page.getByRole('button', { name: 'Delete room', exact: true }).tap();
      await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
      assert.equal(state.roomCalls, 0);
      await page.getByRole('button', { name: 'Delete room', exact: true }).tap();
      state.failRoom = true;
      await page.getByRole('button', { name: 'Confirm delete room', exact: true }).tap();
      await page.getByText('We cannot connect right now. Please check back shortly.', { exact: true }).first().waitFor();
      await page.getByTestId('room-toolbar').getByRole('button', { name: 'Room members', exact: true }).tap();
      await page.getByRole('heading', { name: 'Members · 1', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close room panel', exact: true }).tap();
      await more();
      assert.equal(await page.getByRole('button', { name: 'Confirm delete room', exact: true }).count(), 0, 'reopening starts with a fresh confirmation');
      await page.getByRole('button', { name: 'Delete room', exact: true }).tap();
      await page.getByRole('button', { name: 'Confirm delete room', exact: true }).tap();
      await page.getByTestId('room-toolbar').waitFor({ state: 'hidden' });
      await page.getByTestId('lobby-navigation').getByRole('tab', { name: 'Home', exact: true }).tap();
      await openProfile(page);
      await page.getByRole('button', { name: 'Back from profile', exact: true }).tap();
      await page.getByTestId('profile-screen').waitFor({ state: 'hidden' });
      assert.equal(state.roomCalls, 2); assert.deepEqual(state.roomHiddenAtRequest, [true, true]);
      assert.deepEqual(owner.errors, []); assert.deepEqual(owner.external, []);
      console.log('PASS room options: cancel, failure, usable room, fresh confirmation, retry, usable lobby');
    } catch (error) { console.error('Browser errors:', owner.errors, 'External requests:', owner.external); console.error(await owner.page.locator('body').innerText()); throw error; }
    finally { await owner.context.close(); }

    const card = await fixture(browser, false);
    try {
      const { page, state } = card;
      await page.getByTestId('lobby-navigation').getByRole('tab', { name: 'Home', exact: true }).tap();
      await page.getByRole('button', { name: 'Delete Deletion fixture', exact: true }).tap();
      await page.getByRole('button', { name: 'Cancel', exact: true }).tap(); assert.equal(state.roomCalls, 0);
      await page.getByRole('button', { name: 'Delete Deletion fixture', exact: true }).tap();
      state.failRoom = true;
      await page.getByRole('button', { name: 'Delete room', exact: true }).tap();
      await page.getByText('We cannot connect right now. Please check back shortly.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Delete room', exact: true }).tap();
      await page.getByTestId(`room-card-${room.room_id}`).waitFor({ state: 'hidden' });
      await openProfile(page);
      await page.getByRole('button', { name: 'Back from profile', exact: true }).tap();
      assert.equal(state.roomCalls, 2); assert.deepEqual(state.roomHiddenAtRequest, [true, true]);
      assert.deepEqual(card.errors, []); assert.deepEqual(card.external, []);
      console.log('PASS lobby room card: cancel, closed confirmation before request, failure/retry and usable lobby');
    } catch (error) { console.error(await card.page.locator('body').innerText()); throw error; }
    finally { await card.context.close(); }

    for (const inRoom of [false, true]) {
      const profile = await fixture(browser, inRoom);
      try {
        const { page, state } = profile;
        await openProfile(page);
        await page.getByTestId('profile-name-edit').click();
        await page.getByRole('textbox', { name: 'Profile name', exact: true }).fill('Updated Owner');
        await page.getByRole('button', { name: 'Save display name', exact: true }).tap();
        await page.getByTestId('profile-identity').getByRole('heading', { name: 'Updated Owner', exact: true }).waitFor();
        await page.getByRole('link', { name: 'Privacy', exact: true }).tap();
        await page.getByTestId('profile-screen').waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Back', exact: true }).tap();
        await openProfile(page);
        await page.getByRole('button', { name: 'Delete account', exact: true }).tap();
        await page.getByTestId('profile-screen').waitFor({ state: 'hidden' });
        const confirm = page.getByRole('button', { name: 'Confirm account deletion', exact: true });
        await confirm.waitFor(); assert.equal(await confirm.isDisabled(), true); assert.equal(state.accountCalls, 0);
        await page.getByRole('button', { name: 'Back', exact: true }).tap();
        await openProfile(page);
        await page.getByRole('button', { name: 'Delete account', exact: true }).tap();
        await page.getByRole('textbox', { name: 'Current password', exact: true }).fill('incorrect');
        await page.getByRole('textbox', { name: 'Type DELETE to confirm', exact: true }).fill('DELETE');
        await confirm.tap();
        await page.getByText('The password or confirmation link is invalid or expired.', { exact: true }).waitFor();
        await page.getByRole('textbox', { name: 'Current password', exact: true }).fill('fixture-password');
        await confirm.tap();
        await page.getByText('Deletion requested. Account access has been disabled. Cleanup is pending; keep this page to check its status.', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Back', exact: true }).tap();
        await page.getByRole('button', { name: 'Continue with username or email', exact: true }).waitFor();
        assert.equal(state.accountCalls, 2); assert.deepEqual(state.accountHiddenAtRequest, [true, true]);
        assert.deepEqual(profile.errors, []); assert.deepEqual(profile.external, []);
        console.log(`PASS ${inRoom ? 'room' : 'lobby'} profile: edit, policy/back, deletion/back, proof failure and success`);
      } catch (error) { console.error(await profile.page.locator('body').innerText()); throw error; }
      finally { await profile.context.close(); }

      const signOut = await fixture(browser, inRoom);
      try {
        await openProfile(signOut.page);
        await signOut.page.getByRole('button', { name: 'Sign out', exact: true }).tap();
        await signOut.page.getByTestId('profile-screen').waitFor({ state: 'hidden' });
        await signOut.page.getByRole('button', { name: 'Sign in or sign up', exact: true }).tap();
        await signOut.page.getByRole('button', { name: 'Continue with username or email', exact: true }).waitFor();
        assert.equal(signOut.state.signOutCalls, 1);
        assert.deepEqual(signOut.errors, []); assert.deepEqual(signOut.external, []);
        console.log(`PASS ${inRoom ? 'room' : 'lobby'} profile sign-out returns to usable sign-in`);
      } catch (error) { console.error('Sign-out errors:', signOut.errors); console.error(await signOut.page.locator('body').innerText()); throw error; }
      finally { await signOut.context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
