// Real backend :8000 and Expo :8081. Fresh guest entry must collect a profile name.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 850 } });
    const errors = []; let guestRequests = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (new URL(r.url()).pathname === '/auth/guest') guestRequests++; });
    await page.goto('http://localhost:8081');
    await page.getByRole('button', { name: 'Play as guest', exact: true }).click();
    const field = page.getByRole('textbox', { name: 'Guest display name', exact: true });
    await field.waitFor();
    assert.equal(guestRequests, 0);
    const submit = page.getByRole('button', { name: 'Continue as guest', exact: true });
    assert.equal(await submit.isDisabled(), true);
    await field.fill('  Prajwal  ');
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/auth/guest');
    await submit.click();
    const credentials = await (await response).json();
    await field.waitFor({ state: 'hidden' });
    const profile = await fetch('http://localhost:8000/me/profile', { headers: { Authorization: `Bearer ${credentials.token}` } });
    assert.deepEqual(await profile.json(), { display_name: 'Prajwal' });
    await page.reload();
    await page.getByRole('button', { name: 'Available rooms', exact: true }).waitFor();
    assert.equal(await field.count(), 0);
    assert.equal(guestRequests, 1);
    assert.deepEqual(errors, []);
    console.log('PASS: guest name required, saved before entry, and retained after reload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
