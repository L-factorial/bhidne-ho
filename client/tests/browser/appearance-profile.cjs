const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const response = await fetch(site + '/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `fixed_${Date.now()}`, display_name: 'Fixed design', password: 'Fixed-design-123' }) });
    assert.ok(response.ok); const user = await response.json();
    const saved = await fetch(site + '/me/profile/appearance', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` }, body: JSON.stringify({ theme: 'himalayan', mode: 'dark' }) });
    assert.ok(saved.ok);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const errors = [], appearanceRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/profile/appearance')) appearanceRequests.push(request.url()); });
    await page.addInitScript(({ site, user }) => {
      localStorage.setItem('bhidne.appearance', 'dark');
      localStorage.setItem('bhidne.appearance.v2', JSON.stringify({ theme: 'courtyard', mode: 'dark' }));
      localStorage.setItem(`bhidne.appearance.v2:${site}:${user.user_id}`, JSON.stringify({ theme: 'himalayan', mode: 'dark', pending: true }));
      sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: user, room: null, game: null }));
    }, { site, user });
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      await page.goto(site);
      await page.getByRole('button', { name: 'Open profile', exact: true }).click();
      await page.getByTestId('profile-screen').waitFor();
      assert.equal(await page.getByRole('radio', { name: /^(Dark|Light|System|Heritage|Himalayan|Courtyard)$/ }).count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Appearance', exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(6, 43, 35)');
      await page.getByRole('button', { name: 'Back from profile', exact: true }).click();
    }
    assert.deepEqual(appearanceRequests, []); assert.deepEqual(errors, []);
    console.log('PASS default game theme ignores device and legacy preferences; no legacy appearance requests');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
