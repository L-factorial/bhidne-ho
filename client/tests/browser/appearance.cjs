const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8081');
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('bhidne.appearance')), 'light');
    await page.reload();
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).waitFor();
    await page.screenshot({ path: '../.venv/dev/welcome-light.png' });
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await page.screenshot({ path: '../.venv/dev/welcome-dark.png' });
    await page.getByRole('button', { name: 'Play as guest', exact: true }).click();
    await page.getByRole('button', { name: 'Open profile', exact: true }).click();
    await page.getByTestId('profile-screen').getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await page.screenshot({ path: '../.venv/dev/profile-light.png' });
    await page.getByRole('button', { name: 'Back from profile', exact: true }).click();
    await page.getByTestId('profile-screen').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).waitFor();
    await page.screenshot({ path: '../.venv/dev/rooms-light.png' });
    await page.setViewportSize({ width: 360, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log('PASS: system theme, saved appearance after reload, welcome, profile and lobby theme switching.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
