// Isolated browser fixtures; preference changes stay on this browser's device.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./game-stats.cjs');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8117';

async function profile(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.addInitScript(site => {
    if (!localStorage.getItem('bhidne.table-theme.v1')) localStorage.setItem('bhidne.table-theme.v1', 'pearl');
    if (!localStorage.getItem('bhidne.language')) localStorage.setItem('bhidne.language', 'en');
    sessionStorage.setItem('bhidne.session.v1:' + site, JSON.stringify({ session: { user_id: 'u0', token: 'fixture' }, room: null, game: null }));
  }, site);
  await context.route(site + '/**', async route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    if (p === '/' || p.startsWith('/assets/') || p.startsWith('/_expo/') || p === '/favicon.ico') return route.continue();
    if (request.method() !== 'GET') writes.push(p);
    let body = [];
    if (p === '/auth/me' || p === '/me/profile') body = { user_id: 'u0', username: 'sigma', display_name: 'Sigma' };
    else if (p === '/friends') body = { friends: [], incoming: [], outgoing: [], online_friend_ids: [] };
    else if (p === '/me/community-rules') body = { accepted: true, version: '2026-10-01' };
    await route.fulfill({ json: body });
  });
  await page.goto(site);
  await page.getByRole('button', { name: 'Open profile', exact: true }).click();
  const screen = page.getByTestId('profile-screen'), selector = page.getByTestId('profile-card-theme');
  await selector.scrollIntoViewIfNeeded();
  const before = await screen.evaluate(n => ({ height: n.clientHeight, scroll: n.scrollHeight }));
  await selector.getByRole('button', { name: 'Choose card theme', exact: true }).click();
  const dropdown = page.getByTestId('card-theme-dropdown');
  const after = await screen.evaluate(n => ({ height: n.clientHeight, scroll: n.scrollHeight }));
  assert.deepEqual(after, before, 'opening dropdown must not enlarge the profile');
  assert.equal(await selector.evaluate(n => n === n.parentElement.lastElementChild), true);
  const dimensions = await dropdown.evaluate(n => ({ height: n.clientHeight, scroll: n.scrollHeight }));
  assert.equal(dimensions.height, 234); assert.ok(dimensions.scroll > dimensions.height);
  const profileScroll = await screen.evaluate(n => n.scrollTop);
  await dropdown.hover(); await page.mouse.wheel(0, 300); await page.waitForTimeout(150);
  assert.ok(await dropdown.evaluate(n => n.scrollTop>0), 'dropdown must scroll internally');
  assert.equal(await screen.evaluate(n => n.scrollTop), profileScroll, 'dropdown scrolling must not move the profile');
  assert.equal(await dropdown.getByRole('radio').count(), 10);
  const previews = await selector.locator('img').evaluateAll(nodes => nodes.map(n => {
    const r = n.parentElement.getBoundingClientRect(); return [r.width, r.height];
  }));
  assert.ok(previews.length >= 11 && previews.every(([w,h]) => w === 36 && h === 54));
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/bhidne-profile-card-dropdown-${width}.png` });
  await dropdown.getByRole('radio', { name: 'Rara Lake', exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem('bhidne.card-theme.v1') === 'rara');
  await dropdown.waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('button', { name: 'Open profile', exact: true }).click();
  await page.getByTestId('profile-card-theme').getByText('Rara Lake', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeFamily), 'pearl');
  await page.evaluate(() => localStorage.setItem('bhidne.language', 'ne'));
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('खेल्नुहोस्'));
  assert.equal(await page.evaluate(() => localStorage.getItem('bhidne.language')), 'ne');
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  await context.close();
  console.log(`PASS ${width}px profile: bottom selector, three compact rows, internal scroll, device preferences survive reload.`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390,1280]) await profile(browser, width);
    for (const kind of ['callbreak','marriage','flush']) for (const width of [390,1280]) {
      const f = await fixture(browser, kind, 4, width);
      const { page } = f;
      const ring = page.getByTestId('active-turn-ring').first(); await ring.waitFor();
      const geometry = await ring.evaluate(n => {
        const r = n.getBoundingClientRect(), p = n.parentElement.getBoundingClientRect();
        const child = n.firstElementChild, s = getComputedStyle(child), a = child.getBoundingClientRect();
        return { x: r.x+r.width/2-(p.x+p.width/2), y: r.y+r.height/2-(p.y+p.height/2),
          square: Math.abs(a.width-a.height), children: n.children.length,
          borders: [s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor] };
      });
      assert.ok(Math.abs(geometry.x)<1 && Math.abs(geometry.y)<1, 'ring must be centered');
      assert.ok(geometry.square<1); assert.equal(geometry.children,1);
      assert.equal(new Set(geometry.borders).size,1);
      const scales = [];
      for (let i=0;i<4;i++) {
        const [x,y] = await ring.evaluate(n => {
          const m = new DOMMatrixReadOnly(getComputedStyle(n.firstElementChild).transform); return [m.a,m.d];
        });
        assert.ok(Math.abs(x-y)<.001, 'pulse must scale uniformly'); scales.push(x);
        await page.waitForTimeout(180);
      }
      assert.ok(Math.max(...scales)-Math.min(...scales)>.02, 'ring must pulse outward');
      const art = page.getByTestId(/^card-back-art-/).first();
      if (kind === 'callbreak') {
        const expand = page.getByTestId('hand-attention-collapsed');
        if (await expand.isVisible()) await expand.click();
        if (await art.count() === 0) {
          const options = page.getByRole('button', { name: 'Hand options', exact: true });
          if (await options.isVisible()) await options.click();
          await page.getByRole('button', { name: 'Hide cards', exact: true }).click();
        }
      }
      await art.waitFor({ state: 'attached' });
      const images = await page.getByTestId(/^card-back-art-/).evaluateAll(nodes => nodes.map(n => {
        const a=n.getBoundingClientRect(), b=n.parentElement.getBoundingClientRect(), s=getComputedStyle(n.firstElementChild);
        return { dx:a.x-b.x,dy:a.y-b.y,dw:a.width-b.width,dh:a.height-b.height,fit:s.backgroundSize };
      }));
      assert.ok(images.length>0 && images.every(r=>[r.dx,r.dy,r.dw,r.dh].every(v=>Math.abs(v)<1)), 'artwork must fill its card');
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/bhidne-card-alignment-${kind}-${width}.png` });
      if (width === 390) {
        await page.getByRole('button', { name: 'Table menu', exact: true }).click();
        await page.getByTestId(`${kind}-menu-settings`).getByRole('button', { name: 'Open profile', exact: true }).click();
        const selector = page.getByTestId('profile-card-theme'); await selector.scrollIntoViewIfNeeded();
        await selector.getByRole('button', { name: 'Choose card theme', exact: true }).click();
        await selector.getByRole('radio', { name: 'Rara Lake', exact: true }).click();
        await page.waitForFunction(() => localStorage.getItem('bhidne.card-theme.v1') === 'rara');
        await page.getByRole('button', { name: 'Back from profile', exact: true }).click();
        await art.waitFor({ state: 'attached' });
        assert.equal(await art.getAttribute('data-testid'), 'card-back-art-kathmandu', 'personal default must not change the shared table');
      }
      assert.deepEqual(f.errors,[]); assert.deepEqual(f.writes,[]);
      await f.context.close();
      console.log(`PASS ${kind} ${width}px: centered circular turn ring and aligned card artwork.`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
