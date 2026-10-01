// Run against a disposable distributed runtime and a distributed-original web
// export built with its local API URL. Never point this test at production.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const site = process.env.TEST_WEB_URL || 'http://localhost:4174';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(site).hostname));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [game, width] of [['Flush', 390], ['Marriage', 390], ['Call Break', 1280]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      let creations = 0;
      page.on('pageerror', error => errors.push(error.message));
      // Keep every request local, even if an export accidentally cached a
      // production API URL. Allow WebSocket updates to race the HTTP response.
      await page.route('**/*', async route => {
        const request = route.request();
        if (new URL(request.url()).origin !== new URL(site).origin) return route.abort();
        if (request.method() === 'POST' && request.url().endsWith('/distributed/commands')
            && request.postDataJSON()?.body?.command === 'create-table') {
          creations++;
          const response = await route.fetch();
          await new Promise(resolve => setTimeout(resolve, 800));
          return route.fulfill({ response });
        }
        return route.continue();
      });
      await page.goto(site);
      await page.getByRole('button', { name: 'Sign in or create account' }).click();
      await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await page.getByRole('button',{name:'Sign up with username or email',exact:true}).click();
      await page.getByLabel('Profile name', { exact: true }).fill('Creation test');
      await page.getByLabel('Username', { exact: true }).fill(`create_${Date.now()}`);
      await page.getByLabel('Password', { exact: true }).fill('Local-test-password-42');
      await page.getByLabel('Email', { exact: true }).fill('table-creation@example.test');
      await page.getByLabel('Password', { exact: true }).press('Enter');
      await page.getByLabel('Confirm password', { exact: true }).fill('Local-test-password-42');
      await page.getByLabel('Confirm password', { exact: true }).press('Enter');
      await page.getByRole('button', { name: 'Create room', exact: true }).first().click();
      await page.getByLabel('Room name', { exact: true }).fill('Creation regression');
      await page.getByRole('button', { name: 'Create room', exact: true }).last().click();
      await page.getByTestId('room-empty-tables').waitFor();
      await page.getByRole('button', { name: 'Create table', exact: true }).first().click();
      await page.getByRole('button', { name: `Choose ${game}`, exact: true }).click();
      await page.getByLabel('Table name', { exact: true }).fill('Open immediately');
      await page.getByRole('button', { name: 'Create this table', exact: true }).click();
      await page.getByTestId('live-game-overlay').waitFor({ timeout: 12000 });
      assert.equal(creations, 1, 'Opening the table must not resubmit creation');
      await page.getByRole('button', { name: 'Table menu', exact: true }).click();
      await page.getByRole('button', { name: /Switch language to/ }).click();
      await page.getByRole('button', { name: game === 'Marriage' ? 'नियम र सेटिङहरू' : 'नियमहरू', exact: true }).waitFor({ timeout: 10000 });
      assert.ok(await page.getByText('Open immediately', { exact: true }).count(), 'Table name must survive a language switch');
      assert.equal(creations, 1, 'Changing language must not recreate the table');
      assert.deepEqual(errors, []);
      console.log(`PASS ${game} ${width}px: delayed creation and language switch preserve the table`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
