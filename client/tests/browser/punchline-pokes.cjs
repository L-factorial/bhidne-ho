// UI fixtures only; tests/test_table_social.py verifies actual server delivery/validation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8099';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['flush', 'callbreak', 'marriage']) {
      const base = JSON.parse(fs.readFileSync(path.join(process.env.FIXTURE_DIR || '/tmp', `bhidne-social-${kind}.json`)));
      const room = { room_id: 'room', name: 'Poke room', members: ['u0', 'u1', 'u2', 'u3'], connected_members: ['u0', 'u1', 'u2', 'u3'] };
      const sockets = [], pages = [], contexts = [], commands = [], errors = [];
      let rejectNext = true;
      for (const index of [0, 1]) {
        const snapshot = structuredClone(base);
        snapshot.your_player_id = index + 1;
        snapshot.table.current_user.seat_id = index + 1;
        const context = await browser.newContext({ viewport: { width: index ? 1280 : 390, height: 844 }, hasTouch: true, reducedMotion: kind === 'marriage' && index === 1 ? 'reduce' : 'no-preference' });
        contexts.push(context);
        await context.addInitScript(({ room, kind, site, index }) => {
          localStorage.setItem('bhidne.language', 'en');
          sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: { user_id: `u${index}`, token: 'mock' }, room, game: kind }));
        }, { room, kind, site, index });
        await context.route(site + '/**', async route => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === '/' || pathname.startsWith('/_expo/') || pathname.startsWith('/assets/') || pathname === '/favicon.ico') return route.continue();
          let data = [];
          if (pathname === '/rooms') data = [room];
          if (pathname === '/me/phrases') data = [{ id: 'saved', text: 'My lucky table!' }];
          if (pathname.startsWith('/test-games/')) {
            assert.equal(route.request().method(), 'GET', 'pokes must not submit gameplay actions');
            data = snapshot;
          }
          await route.fulfill({ json: data });
        });
        await context.routeWebSocket(site.replace(/^http/, 'ws') + '/**', ws => {
          sockets.push(ws); ws.send(JSON.stringify({ type: 'CONNECTED' }));
          ws.onMessage(raw => {
            const command = JSON.parse(raw);
            if (command.type === 'HEARTBEAT') return ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }));
            const ack = { type: 'TABLE_SOCIAL_ACK', room_id: 'room', match_id: base.match_id, command_id: command.command_id, status: 'accepted', messages: [] };
            if (command.type === 'TABLE_POKE_SEND') {
              commands.push(command);
              if (rejectNext) { rejectNext = false; ack.status = 'rejected'; ack.detail = 'Try again'; }
              else {
                const event = { type: 'TABLE_REACTION', id: command.command_id, room_id: 'room', match_id: base.match_id, sender_id: 'u0', sender_name: 'Player 1', sender_player_id: 1,
                  recipient_id: 'u1', recipient_player_id: 2, reaction: command.payload.reaction, text: command.payload.text, expires_at: Date.now() + 5000 };
                sockets.forEach(socket => { socket.send(JSON.stringify(event)); socket.send(JSON.stringify(event)); });
              }
            }
            ws.send(JSON.stringify(ack));
          });
        });
        const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(site);
        await page.getByRole('button', { name: /Return to table/ }).first().click();
        await page.getByTestId('game-social-controls').waitFor();
      }
      const page = pages[0], button = name => page.getByRole('button', { name, exact: true });
      await button('Poke a player').tap();
      await page.getByTestId('poke-tools').getByRole('button', { name: 'Poke Player 2', exact: true }).tap();
      await page.getByRole('tab', { name: 'Punchlines', exact: true }).tap();
      const input = page.getByRole('textbox', { name: 'Punchline', exact: true }), send = button('Send punchline');
      assert.ok(await send.isDisabled());
      await button('My lucky table!').tap();
      assert.equal(await input.inputValue(), 'My lucky table!');
      await button('Nice move!').tap();
      assert.equal(await input.inputValue(), 'Nice move!');
      await input.fill('x'.repeat(65)); assert.equal((await input.inputValue()).length, 60);
      await input.fill('Nice move, my friend!');
      const a = await input.boundingBox(), b = await send.boundingBox();
      assert.ok(a.x + a.width <= b.x && Math.abs(a.y + a.height - b.y - b.height) < 2, 'send arrow sits beside input');
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 380 });
        window.visualViewport.dispatchEvent(new Event('resize'));
      });
      await page.waitForTimeout(200);
      const keyboardSend = await send.boundingBox();
      assert.ok(keyboardSend.y >= 0 && keyboardSend.y + keyboardSend.height <= 380, 'send remains above simulated keyboard');
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 844 });
        window.visualViewport.dispatchEvent(new Event('resize'));
      });
      await send.tap(); await page.getByTestId('poke-tools').getByText('Try again', { exact: true }).waitFor();
      assert.equal(await input.inputValue(), 'Nice move, my friend!', 'failed send preserves draft');
      await send.tap(); await page.getByTestId('poke-tools').waitFor({ state: 'hidden' });
      for (const viewer of pages) {
        await viewer.getByTestId('table-punchline-flight').waitFor();
        assert.equal(await viewer.getByTestId('table-punchline-flight').count(), 1, 'duplicate broadcasts render once');
        assert.ok((await viewer.getByTestId('table-punchline-flight').innerText()).includes('Nice move, my friend!'));
      }
      await pages[1].getByTestId('table-punchline-catch').waitFor();
      if (process.env.ARTIFACT_DIR) await pages[0].screenshot({ path: path.join(process.env.ARTIFACT_DIR, `punchline-${kind}.png`) });
      for (const viewer of pages) await viewer.getByTestId('table-punchline-flight').waitFor({ state: 'hidden' });
      assert.equal(commands.length, 2);
      assert.equal(commands[1].payload.recipient_player_id, 2);
      assert.equal(commands[1].payload.reaction, 'punchline');
      assert.deepEqual(errors, []);
      await Promise.all(contexts.map(context => context.close()));
      console.log(`PASS ${kind}: picker, right-side send, validation, rejected draft, broadcast animation, recipient catch, dedup and fade`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
