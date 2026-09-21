// Serve an exported build at TEST_WEB_URL. Provider and auth responses are mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const provider of ['google', 'apple', 'facebook']) {
      const context = await browser.newContext();
      const attempt = provider + '-attempt-' + 'x'.repeat(32), secret = 'private-client-proof-' + 's'.repeat(32);
      const handoff = 'callback-proof-' + 'h'.repeat(32), token = 'private-application-session';
      let completed = 0;
      const logs = [], errors = [];
      await context.route(site + '/auth/social/browser/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/providers')) return route.fulfill({ json: { providers: ['google', 'apple', 'facebook'] } });
        if (path.endsWith('/start')) {
          assert.deepEqual(route.request().postDataJSON(), { redirect_uri: site + '/' });
          return route.fulfill({ json: { attempt_id: attempt, secret, authorization_url: `https://provider.example/${provider}` } });
        }
        if (path.endsWith('/complete')) {
          assert.deepEqual(route.request().postDataJSON(), { attempt_id: attempt, secret, handoff });
          completed++;
          return route.fulfill({ json: { user_id: 'user-social', token } });
        }
        throw new Error('Unexpected social request');
      });
      await context.route('https://provider.example/**', route => route.fulfill({ status: 302,
        headers: { location: `${site}/?social_attempt=${attempt}&social_code=${handoff}` } }));
      for (const path of ['/rooms', '/memberships', '/players/**', '/test-games/invitations']) {
        await context.route(site + path, route => route.fulfill({ json: [] }));
      }
      await context.route(site + '/auth/me', route => route.fulfill({ json: { user_id: 'user-social', display_name: 'Social Player' } }));
      const page = await context.newPage();
      page.on('console', message => logs.push(message.text()));
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(site);
      await page.getByRole('button', { name: `Continue with ${provider[0].toUpperCase() + provider.slice(1)}` }).click();
      await page.getByText('YOUR LOBBY', { exact: true }).waitFor();
      assert.equal(completed, 1);
      assert.equal(page.url(), site + '/');
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), `bhidne.social.v1:${site}`), null);
      assert.equal(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).session.token, `bhidne.session.v1:${site}`), token);
      assert.ok(!logs.join('\n').includes(token) && !logs.join('\n').includes(secret));
      assert.deepEqual(errors, []);
      await context.close();
    }
    // An unsolicited callback cannot sign a different browser into an account.
    const context = await browser.newContext();
    let completed = false;
    await context.route(site + '/auth/social/browser/**', route => {
      if (route.request().url().endsWith('/complete')) completed = true;
      return route.fulfill({ json: { providers: [] } });
    });
    const page = await context.newPage();
    await page.goto(site + '/?social_attempt=unsolicited&social_code=stolen');
    await page.getByRole('alert').filter({ hasText: 'did not start in this app session' }).waitFor();
    assert.equal(completed, false);
    await context.close();
    console.log('Social sign-in browser checks passed for Google, Apple, Facebook and unsolicited callbacks.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
