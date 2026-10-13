// Exported app plus isolated game fixtures; theme changes never touch a live service.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./game-stats.cjs');
const fs = require('node:fs');
const output = process.env.SCREENSHOT_DIR || '/private/tmp/bhidne-nepali-themes';
fs.mkdirSync(output, { recursive: true });
const choices = { classic: 'Chitwan Hariyali', heritage: 'Patan Sampada', dusk: 'Himali Raat', noir: 'Kathmandu Ink', pearl: 'Himali Bihan' };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [320, 390, 1280]) for (const kind of ['callbreak', 'marriage', 'flush']) {
      const f = await fixture(browser, kind, 4, width), { page } = f;
      const surface = page.getByTestId(`table-surface-${kind}`);
      const original = await surface.elementHandle();
      for (const [id, name] of Object.entries(choices)) {
        await page.getByRole('button', { name: 'Table menu', exact: true }).click();
        await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
        const choice = page.getByRole('radio', { name, exact: true });
        await choice.click();
        assert.equal(await choice.getAttribute('aria-checked'), 'true');
        await page.getByRole('button', { name: 'Close themes', exact: true }).click();
        await page.getByTestId('app-theme-sheet').waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Close table menu', exact: true }).click();
        await page.getByTestId(`${kind}-menu-drawer`).waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.themeFamily), id);
        assert.equal(await original.evaluate(el => el.isConnected), true, 'changing theme must retain the table');
        const backdrop = page.getByTestId(`theme-backdrop-${id}`).last();
        await backdrop.waitFor();
        assert.equal(await backdrop.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
        const decorated = true;
        assert.equal(await backdrop.getByTestId('theme-scenery-image').count(), decorated ? 1 : 0);
        assert.equal(await surface.locator('image').count(), decorated ? 1 : 0);
        if (decorated) {
          await backdrop.locator('img').evaluate(async img => { await img.decode(); });
          const href = await surface.locator('image').getAttribute('href');
          await page.evaluate(async href => { const img = new Image(); img.src = href; await img.decode(); }, href);
          if (width === 390) await page.screenshot({ path: `${output}/${kind}-${id}.png` });
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
        await page.waitForFunction(id => localStorage.getItem('bhidne.table-theme.v1') === id, id);
      }
      // Reload retains the stable preference ID rather than falling back to navy.
      await page.reload();
      await page.getByRole('button', { name: /Return to table|Watch/ }).first().click();
      await page.getByTestId('game-stats-toggle').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.themeFamily), 'pearl');
      assert.deepEqual(f.errors, []);
      assert.ok(f.writes.every(p => !p.endsWith('/action')), 'appearance sends no game commands');
      await f.context.close();
      console.log(`PASS ${kind} ${width}: all themes, bundled artwork, neutral backgrounds, persistence and retained table`);
    }
    const f = await fixture(browser, 'callbreak', 4, 390);
    await f.page.getByRole('button', { name: 'Back to lobby', exact: true }).first().evaluate(el => el.click());
    await f.page.getByRole('button', { name: 'Open profile', exact: true }).click();
    await f.page.getByRole('button', { name: 'Choose theme', exact: true }).click();
    await f.page.getByRole('radio', { name: 'Patan Sampada', exact: true }).click();
    await f.page.getByRole('button', { name: 'Close themes', exact: true }).click();
    await f.page.getByRole('button', { name: 'Back from profile', exact: true }).click();
    await f.page.getByTestId('profile-screen').waitFor({ state: 'hidden' });
    await f.page.getByTestId('theme-backdrop-heritage').waitFor();
    await f.page.screenshot({ path: `${output}/lobby-heritage.png` });
    await f.page.getByRole('button', { name: 'Open profile', exact: true }).click();
    await f.page.getByRole('button', { name: 'Choose language', exact: true }).click();
    await f.page.getByRole('radio', { name: 'नेपाली', exact: true }).click();
    await f.page.getByTestId('language-menu').waitFor({ state: 'hidden' });
    await f.page.getByRole('button', { name: 'थिम छान्ने', exact: true }).click();
    for (const name of ['चितवन हरियाली', 'पाटन सम्पदा', 'हिमाली रात', 'काठमाडौं इन्क', 'हिमाली बिहान']) await f.page.getByRole('radio', { name, exact: true }).waitFor();
    assert.deepEqual(f.errors, []);
    await f.context.close();
    console.log('PASS lobby/profile: theme selection and Nepali labels');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
