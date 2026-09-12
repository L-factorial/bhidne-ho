// Real two-player room flow. Requires backend:8000 and Expo web:8081.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = 'http://localhost:8000';
async function api(route, user, body) {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.ok(response.ok, `${route}: ${JSON.stringify(data)}`);
  return data;
}
const label = c => c.card_type === 'man' ? `Man · ${Number(c.card_id.slice(-1)) + 1}`
  : `${({11:'J',12:'Q',13:'K',14:'A'})[c.rank] || c.rank}${({S:'♠',C:'♣',H:'♥',D:'♦'})[c.suit]} · ${c.deck_index + 1}`;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const users = await Promise.all([api('/auth/guest', null, {}), api('/auth/guest', null, {})]);
    const room = await api('/rooms', users[0], { name: `Marriage browser ${Date.now()}` });
    const errors = [];
    const pages = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: i ? { width: 1280, height: 900 } : { width: 360, height: 800 } });
      await context.addInitScript(({ user, room }) => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',
        JSON.stringify({ session: user, room, game: 'marriage' })), { user: users[i], room });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && /same key|unique.*key|Maximum update depth/i.test(m.text())) errors.push(m.text()); });
      await page.goto('http://localhost:8081');
      pages.push(page);
    }
    const [one, two] = pages;
    await one.getByRole('button', { name: 'Create a game', exact: true }).click();
    await one.getByRole('button', { name: 'Create game', exact: true }).click();
    await one.getByRole('button', { name: '2 players', exact: true }).click();
    await one.getByRole('button', { name: 'Create Marriage game', exact: true }).click();
    await two.getByRole('button', { name: 'View game', exact: true }).click();
    await two.getByRole('button', { name: 'Join game', exact: true }).click();
    await one.getByTestId('marriage-table').waitFor();
    await two.getByTestId('marriage-table').waitFor();
    await one.getByRole('button', { name: 'Player play', exact: true }).click();
    await one.getByRole('button', { name: 'Start game', exact: true }).click();
    for (const page of pages) await page.getByRole('button', { name: 'Reveal all cards', exact: true }).click();
    await one.getByRole('button', { name: /Take stock/ }).click();
    await one.getByText('Your cards · 22', { exact: true }).waitFor();
    const root = `/test-games/${room.room_id}`;
    const snap = await api(root, users[0]);
    const card = snap.marriage.private.hand.at(-1);
    await one.getByRole('button', { name: label(card), exact: true }).click();
    await one.getByRole('button', { name: `Discard ${label(card)}`, exact: true }).click();
    await two.getByRole('button', { name: 'Take discard', exact: true }).click();
    await two.getByText('Your cards · 22', { exact: true }).waitFor();
    await two.getByRole('button', { name: 'Hide cards', exact: true }).click();
    assert.equal(await two.getByTestId('marriage-hand').getByText(label(card), { exact: true }).count(), 0);
    await two.getByRole('button', { name: 'Show cards', exact: true }).click();
    for (const mode of ['Suit groups', 'Grid']) await two.getByRole('button', { name: mode, exact: true }).click();
    const hand = (await api(root, users[1])).marriage.private.hand;
    await two.getByRole('button', { name: label(hand[0]), exact: true }).click();
    await two.getByRole('button', { name: label(hand[1]), exact: true }).click();
    await two.getByRole('button', { name: 'Add group · 2 cards', exact: true }).click();
    await two.getByRole('button', { name: 'Remove group 1', exact: true }).click();
    await two.getByRole('button', { name: 'Rules', exact: true }).click();
    await two.getByText('Three sequences / Tunnelas unlock Maal. Normal-hand winning and scoring are not available yet.', { exact: true }).waitFor();
    await one.screenshot({ path: path.resolve('../.venv/dev/marriage-mobile.png'), fullPage: true });
    await two.screenshot({ path: path.resolve('../.venv/dev/marriage-desktop.png'), fullPage: true });
    for (const page of pages) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
    }
    await two.reload();
    await two.getByTestId('marriage-table').waitFor();
    await two.getByText('Your cards · 22', { exact: true }).waitFor();
    await one.getByRole('button', { name: 'End game', exact: true }).click();
    await one.getByRole('button', { name: 'End game for everyone', exact: true }).click();
    await two.getByText('Game ended', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: real Marriage create/join/start, private 21/22 cards, draw/discard, views, grouping, rules, reload, and end on mobile/desktop.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
