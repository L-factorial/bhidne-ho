const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8097';
async function api(path, user, body) {
  const response = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const username = `profile_${Date.now()}`, password = 'Profile-test-123';
    await page.goto(site);
    await page.getByRole('button', { name: 'Sign in or create account', exact: true }).click();
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const create = page.getByRole('button', { name: 'Create account', exact: true });
    assert.equal(await create.isDisabled(), true);
    await page.getByLabel('Profile name', { exact: true }).fill('   ');
    assert.equal(await create.isDisabled(), true);
    await page.getByLabel('Profile name', { exact: true }).fill('Sita Rai');
    const registered = page.waitForResponse(response => response.url().endsWith('/auth/signup') && response.status() === 201);
    await create.click();
    const user = await (await registered).json();
    await page.getByRole('button', { name: 'Open profile', exact: true }).waitFor();
    const friend = await api('/auth/signup', null, { username: `friend_${Date.now()}`, password, display_name: 'Ekraj Friend' });
    await api(`/friends/requests/${friend.user_id}`, user, {});
    await api(`/friends/requests/${user.user_id}/accept`, friend, {});
    async function verify(name) {
      await page.getByRole('button', { name: 'Open profile', exact: true }).click();
      await page.getByTestId('profile-identity').getByRole('heading', { name, exact: true }).waitFor();
      await page.getByText(`Profile ID: ${user.user_id}`, { exact: true }).waitFor();
      await page.getByTestId('profile-identity').getByText(`@${username}`, { exact: true }).waitFor();
      await page.getByText('Ekraj Friend', { exact: true }).waitFor();
    }
    await verify('Sita Rai');
    await page.reload();
    await verify('Sita Rai');
    const input = page.getByLabel('Game display name', { exact: true });
    await input.fill('Sita Updated');
    await page.getByRole('button', { name: 'Save display name', exact: true }).click();
    await page.getByTestId('profile-identity').getByRole('heading', { name: 'Sita Updated', exact: true }).waitFor();
    await page.reload();
    await verify('Sita Updated');
    await page.waitForTimeout(350); // Finish the Profile modal slide before visual capture.
    await page.screenshot({ path: '/tmp/profile-identity-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: required signup name, profile identity, name update, and unchanged identity/friends after refresh');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
