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
    await one.getByTestId('marriage-table').getByText('1/2 players seated', { exact: true }).waitFor();
    assert.equal(await one.getByRole('button', { name: 'Start game', exact: true }).isDisabled(), true);
    await one.getByRole('button', { name: 'Rules', exact: true }).click();
    await one.getByRole('button', { name: 'Simple points', exact: true }).click();
    await one.getByLabel('Loser payment: Maal seen', { exact: true }).fill('7');
    await one.getByRole('button', { name: 'Save scoring rules', exact: true }).click();
    await one.getByText('Saved rules apply when the game starts.', { exact: true }).waitFor();
    await one.getByRole('button', { name: 'Close details', exact: true }).click();
    await one.getByRole('button', { name: 'Collapse game', exact: true }).click();
    await two.getByRole('button', { name: 'View game', exact: true }).click();
    await two.getByRole('button', { name: 'Join game', exact: true }).click();
    await one.getByText('Everyone is ready · the creator can start', { exact: true }).waitFor();
    await one.getByRole('button', { name: 'Go back to game', exact: true }).click();
    await one.getByTestId('marriage-table').waitFor();
    await two.getByTestId('marriage-table').waitFor();
    await two.getByRole('button', { name: 'Rules', exact: true }).click();
    await two.getByTestId('marriage-scoring-rules').waitFor();
    assert.equal(await two.getByRole('button', { name: 'Save scoring rules', exact: true }).count(), 0);
    const saved = await api(`/test-games/${room.room_id}`, users[1]);
    assert.equal(saved.marriage_scoring.seen_payment, 7);
    assert.deepEqual(saved.marriage_scoring.tiplu, [3, 6, 9]);
    await two.getByRole('button', { name: 'Close details', exact: true }).click();
    await one.getByRole('button', { name: 'Player play', exact: true }).click();
    await one.getByRole('button', { name: 'Start game', exact: true }).click();
    for (const page of pages) await page.getByRole('button', { name: 'Reveal all cards', exact: true }).click();
    for (const page of pages) await page.evaluate(() => {
      window.__flights = [];
      const seen = new WeakSet();
      new MutationObserver(() => {
        document.querySelectorAll('[data-testid="marriage-flying-card"]').forEach(card => {
          if (!seen.has(card)) { seen.add(card); window.__flights.push({ label: card.getAttribute('aria-label'), face: card.textContent }); }
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
    for (const page of pages) {
      await page.getByTestId('marriage-stock-spot').waitFor();
      await page.getByTestId('marriage-discard-spot').waitFor();
      assert.equal(await page.getByTestId('marriage-maal-spot').getAttribute('aria-label'), 'Maal hidden');
    }
    await one.getByRole('button', { name: /Take stock/ }).click();
    await one.getByText('Your cards · 22', { exact: true }).waitFor();
    const root = `/test-games/${room.room_id}`;
    const snap = await api(root, users[0]);
    const card = snap.marriage.private.hand.at(-1);
    await one.getByRole('button', { name: label(card), exact: true }).click();
    await one.getByRole('button', { name: `Discard ${label(card)}`, exact: true }).click();
    await two.getByRole('button', { name: 'Take discard', exact: true }).click();
    await two.getByText('Your cards · 22', { exact: true }).waitFor();
    for (const page of pages) {
      await page.waitForFunction(() => window.__flights.length >= 3);
      const flights = await page.evaluate(() => window.__flights);
      assert.equal(flights[0].face, '✦', 'stock draws must stay face down for everyone');
      assert.deepEqual(flights.slice(0, 3).map(f => f.label), ['Card moving to player', 'Card moving to discard', 'Card moving to player']);
      await page.getByTestId('marriage-flying-card').waitFor({ state: 'hidden' });
    }
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
    await two.getByText('Three sequences / Tunnelas unlock Maal. Normal-hand winning is not available yet.', { exact: true }).waitFor();
    await two.getByRole('button', { name: 'Close details', exact: true }).click();
    await two.getByRole('button', { name: 'Stats', exact: true }).click();
    await two.getByText('Game stats', { exact: true }).waitFor();
    await two.getByRole('button', { name: 'Close details', exact: true }).click();
    await one.getByTestId('marriage-player-grid').waitFor();
    await two.getByTestId('marriage-player-grid').waitFor();
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
    // Rematch invitation must be reachable inside the still-open game overlay.
    await one.getByTestId('live-game-overlay').getByRole('button', { name: 'Start a new game', exact: true }).click();
    await one.getByRole('button', { name: 'Create Marriage game', exact: true }).click();
    await two.getByTestId('in-game-invitation').getByText('A new Marriage game is ready!', { exact: true }).waitFor();
    await two.getByTestId('in-game-invitation').getByRole('button', { name: 'Join game', exact: true }).click();
    await two.getByTestId('in-game-invitation').waitFor({ state: 'hidden' });
    await one.getByRole('button', { name: 'Player play', exact: true }).click();
    await one.getByRole('button', { name: 'Start game', exact: true }).click();
    await two.getByRole('button', { name: 'Reveal all cards', exact: true }).waitFor();
    await one.getByRole('button', { name: 'End game', exact: true }).click();
    await one.getByRole('button', { name: 'End game for everyone', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('PASS: real Marriage create/join/start, private 21/22 cards, draw/discard, views, grouping, rules, reload, and end on mobile/desktop.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
