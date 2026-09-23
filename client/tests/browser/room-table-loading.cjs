// Run against an isolated memory-runtime server serving the web export.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1280]) {
      const response = await fetch(site + '/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `load_${width}_${Date.now()}`, password: 'Loading-test-123', display_name: 'Loading test' }) });
      assert.ok(response.ok);
      const session = await response.json();
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await context.addInitScript(({ site, session }) => {
        if (!sessionStorage.getItem(`bhidne.session.v1:${site}`)) sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session, room: null, game: null }));
        // Simulate a proxy that never completes the chat/presence handshake.
        window.WebSocket = class { send() {} close() {} };
      }, { site, session });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(10000);
      await page.goto(site);
      await page.getByRole('button', { name: 'Create room', exact: true }).first().click();
      const sheet = page.getByTestId('room-sheet');
      await sheet.getByRole('textbox', { name: 'Room name', exact: true }).fill('Browser loading regression');
      await sheet.getByRole('button', { name: 'Create room', exact: true }).click();
      await page.getByTestId('room-empty-tables').waitFor();
      await page.getByRole('button', { name: 'Create table', exact: true }).click();
      await page.getByRole('textbox', { name: 'Table name', exact: true }).fill('Works without WebSocket');
      await page.getByRole('button', { name: 'Create this table', exact: true }).click();
      await page.getByText('Works without WebSocket', { exact: true }).first().waitFor();
      const roomsResponse = await fetch(site + '/rooms', { headers: { Authorization: `Bearer ${session.token}` } });
      const rooms = await roomsResponse.json();
      const room = rooms.find(room => room.name === 'Browser loading regression');
      const tablesResponse = await fetch(`${site}/test-games/${room.room_id}`, { headers: { Authorization: `Bearer ${session.token}` } });
      assert.ok(tablesResponse.ok);
      assert.equal((await tablesResponse.json()).tables.length, 1);
      // Re-enter an existing room with its initial HTTP snapshot unavailable.
      let unavailable = true;
      await page.route('**/test-games/**', route => route.request().method() === 'GET' && unavailable
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Table service temporarily unavailable.' }) })
        : route.continue());
      await page.reload();
      await page.getByRole('button', { name: 'Retry loading tables', exact: true }).waitFor();
      assert.equal(await page.getByText('Loading tables…', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Create table', exact: true }).click();
      await page.getByRole('textbox', { name: 'Table name', exact: true }).fill('Keep this draft');
      assert.equal(await page.getByRole('button', { name: 'Create this table', exact: true }).isDisabled(), true);
      unavailable = false;
      await page.getByRole('button', { name: 'Retry table service', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Create this table"]')?.getAttribute('aria-disabled') !== 'true');
      assert.equal(await page.getByRole('textbox', { name: 'Table name', exact: true }).inputValue(), 'Keep this draft');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px: lobby room creation and table creation without WebSocket`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
