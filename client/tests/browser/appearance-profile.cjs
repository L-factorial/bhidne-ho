const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path, user, body) {
  const result = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: {
    'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(result.ok, await result.clone().text()); return result.json();
}
const sessionKey = `bhidne.session.v1:${site}`;
async function install(page, user) {
  await page.evaluate(({ key, user }) => sessionStorage.setItem(key, JSON.stringify({ session: user, room: null, game: null })), { key: sessionKey, user });
  await page.reload();
}
async function appearance(page, theme, mode) {
  await page.waitForFunction(({ theme, mode }) => document.documentElement.dataset.themeFamily === theme && document.documentElement.dataset.theme === mode, { theme, mode });
}
async function profile(page) { await page.getByRole('button', { name: 'Open profile', exact: true }).click(); }
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const credentials = { username: `theme_${Date.now()}`, password: 'Appearance-test-123', display_name: 'Sita Rai' };
    const user = await api('/auth/signup', null, credentials);
    await api('/rooms', user, { name: 'Friday with friends', visibility: 'public' });
    await page.goto(site); await install(page, user); await profile(page);
    await page.getByText('Saved to your profile', { exact: true }).waitFor();
    for (const theme of ['heritage', 'himalayan', 'courtyard']) {
      await page.getByTestId(`theme-option-${theme}`).click();
      for (const mode of ['dark', 'light']) {
        await page.getByRole('radio', { name: mode === 'dark' ? 'Dark' : 'Light', exact: true }).click();
        await appearance(page, theme, mode);
        await page.getByText('Saved to your profile', { exact: true }).waitFor();
      }
    }
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await page.getByText('Saved to your profile', { exact: true }).waitFor();
    assert.deepEqual(await api('/me/profile/appearance', user), { theme: 'courtyard', mode: 'dark' });
    await page.getByTestId('appearance-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/bhidne-appearance-mobile.png', fullPage: true });
    await page.reload(); await appearance(page, 'courtyard', 'dark');
    await page.screenshot({ path: '/tmp/bhidne-courtyard-lobby.png', fullPage: true });
    // A fresh device has no local theme cache, so it must restore the profile.
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    const secondPage = await otherContext.newPage();
    const secondToken = await api('/auth/signin', null, credentials);
    await secondPage.goto(site); await install(secondPage, secondToken); await appearance(secondPage, 'courtyard', 'dark');
    // Unsynced changes survive a reload and are retried after connectivity returns.
    await profile(page);
    const offline = route => route.abort('internetdisconnected');
    await page.route('**/me/profile/appearance', offline);
    await page.getByTestId('theme-option-himalayan').click();
    await page.getByRole('radio', { name: 'Light', exact: true }).click();
    await page.getByText('Profile sync pending. We’ll retry when connected.', { exact: true }).waitFor();
    await page.reload(); await appearance(page, 'himalayan', 'light');
    await page.unroute('**/me/profile/appearance', offline);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await profile(page); await page.getByText('Saved to your profile', { exact: true }).waitFor();
    assert.deepEqual(await api('/me/profile/appearance', user), { theme: 'himalayan', mode: 'light' });
    // Slow saves and rapid input must leave the final selection in the profile.
    await page.route('**/me/profile/appearance', async route => { await new Promise(resolve => setTimeout(resolve, 250)); await route.continue(); });
    await page.getByTestId('theme-option-heritage').click();
    await page.getByTestId('theme-option-courtyard').click();
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await page.getByText('Saved to your profile', { exact: true }).waitFor();
    assert.deepEqual(await api('/me/profile/appearance', user), { theme: 'courtyard', mode: 'dark' });
    await page.unroute('**/me/profile/appearance');
    await page.getByRole('radio', { name: 'Follow device', exact: true }).click();
    await page.getByText('Saved to your profile', { exact: true }).waitFor();
    await page.emulateMedia({ colorScheme: 'dark' }); await appearance(page, 'courtyard', 'dark');
    await page.emulateMedia({ colorScheme: 'light' }); await appearance(page, 'courtyard', 'light');
    const otherUser = await api('/auth/signup', null, { ...credentials, username: `other_${Date.now()}` });
    await install(page, otherUser); await appearance(page, 'heritage', 'light');
    await install(page, user); await appearance(page, 'courtyard', 'light');
    await profile(secondPage);
    await secondPage.getByTestId('appearance-settings').scrollIntoViewIfNeeded();
    await secondPage.screenshot({ path: '/tmp/bhidne-appearance-desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS six palettes, profile save, reload, fresh device, offline retry, rapid changes, system mode, and account isolation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
