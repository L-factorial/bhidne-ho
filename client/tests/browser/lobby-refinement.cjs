// Disposable local distributed runtime only; no production traffic.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const site = process.env.TEST_WEB_URL || 'http://localhost:4174';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(site).hostname));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let failedLobbyOnce = false;
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(site).origin) return route.abort();
        if (!failedLobbyOnce && url.pathname === '/api/distributed/ui/rooms') {
          failedLobbyOnce = true;
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary read failure' }) });
        }
        return route.continue();
      });
      await page.addInitScript(() => {
        window.recoveryFlashes = [];
        new MutationObserver(() => {
          const text = document.body?.innerText || '';
          if (text.includes('Connection interrupted. Retrying') || text.includes('Temporary read failure')) window.recoveryFlashes.push(true);
        }).observe(document, { childList: true, subtree: true, characterData: true });
      });
      await page.goto(site);
      await page.getByRole('button', { name: 'Sign in or sign up' }).click();
      await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await page.getByRole('button',{name:'Sign up with username or email',exact:true}).click();
      await page.getByLabel('Profile name', { exact: true }).fill('Fold');
      await page.getByLabel('Username', { exact: true }).fill(`lobby_${Date.now()}_${width}`);
      await page.getByLabel('Password', { exact: true }).fill('Local-test-password-42');
      await page.getByLabel('Password', { exact: true }).press('Enter');
      await page.getByRole('tab', { name: 'Create or Join', exact: true }).waitFor();
      await page.waitForTimeout(1800); // Allow the failed read's automatic retry and notice grace period.
      assert.equal(failedLobbyOnce, true);
      assert.deepEqual(await page.evaluate(() => window.recoveryFlashes), []);
      assert.equal(await page.getByText('Ready to play?', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('tab', { name: 'Recent', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Join with code', exact: true }).count(), 0);
      const nav = page.getByTestId('lobby-navigation');
      const tabStyle = await nav.getByRole('tab', { name: 'Games', exact: true }).evaluate(el => ({ color: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderWidth }));
      assert.equal(tabStyle.color, 'rgba(0, 0, 0, 0)');
      await page.getByRole('tab', { name: 'Create or Join', exact: true }).click();
      await page.getByRole('button', { name: 'Join with code', exact: true }).waitFor();
      await page.screenshot({ path: `/private/tmp/bhidne-lobby-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Create room', exact: true }).first().click();
      await page.getByLabel('Room name', { exact: true }).fill('Fold room');
      await page.getByRole('button', { name: 'Create room', exact: true }).last().click();
      const hero = page.getByTestId('room-hero');
      await hero.waitFor();
      assert.ok((await hero.boundingBox()).height < 180, 'Room header should be compact');
      assert.equal(await hero.getByLabel(/Room code/).count(), 0);
      await page.getByRole('button', { name: 'Open profile', exact: true }).click();
      await page.getByRole('button', { name: /Switch language to/ }).click();
      await page.getByText('मेरा रमाइला भनाइ · 0', { exact: true }).waitFor();
      assert.equal(await page.getByText('My goofy phrases · 0', { exact: true }).count(), 0);
      assert.equal(await page.getByText(/Your keywords and inside jokes/).count(), 0);
      await page.getByRole('button', { name: 'प्रोफाइलबाट फर्कने', exact: true }).click();
      await page.getByText('भिड्ने हो ?', { exact: true }).waitFor();
      await hero.getByText('Fold room', { exact: true }).waitFor();
      await hero.getByRole('button', { name: 'कोठामा बोलाउने', exact: true }).click();
      await page.getByText('कोठाको लिङ्क वा कोड सेयर गर्नुहोस्। निजी कोठामा प्रवेश गर्न मालिकको निमन्त्रणा पनि चाहिन्छ।', { exact: true }).waitFor();
      assert.equal(await page.getByText('Share the room link or code. Private rooms also require an invitation from the owner.', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Only invited people and existing members can enter. Links do not grant access.', { exact: true }).count(), 0);
      await page.screenshot({ path: `/private/tmp/bhidne-room-ne-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      console.log(`PASS lobby/room layout and live language switch at ${width}px`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
