// Generate snapshots with scripts/social_browser_fixtures.py; set FIXTURE_DIR if needed.
// Touch/focus regression only: a real iPhone is still needed to verify its keyboard.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8099';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['flush', 'callbreak', 'marriage']) {
      const snapshot = JSON.parse(fs.readFileSync(path.join(process.env.FIXTURE_DIR || '/tmp', `bhidne-social-${kind}.json`)));
      const room = { room_id: 'room', name: 'Chat room', members: ['u0', 'u1'], connected_members: ['u0', 'u1'] };
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await context.addInitScript(({ room, kind, site }) => {
        localStorage.setItem('bhidne.language', 'en');
        sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: kind }));
      }, { room, kind, site });
      const history = [], errors = [], gameplay = [];
      await context.route(site + '/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/' || pathname.startsWith('/_expo/') || pathname.startsWith('/assets/') || pathname === '/favicon.ico') return route.continue();
        let data = [];
        if (pathname === '/rooms') data = [room];
        if (pathname.startsWith('/test-games/')) {
          data = snapshot;
          if (route.request().method() === 'POST') gameplay.push(pathname);
        }
        await route.fulfill({ json: data });
      });
      await context.routeWebSocket(site.replace(/^http/, 'ws') + '/**', ws => {
        ws.send(JSON.stringify({ type: 'CONNECTED' }));
        ws.onMessage(raw => {
          const command = JSON.parse(raw);
          if (command.type === 'HEARTBEAT') return ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }));
          const ack = { type: 'TABLE_SOCIAL_ACK', room_id: 'room', match_id: snapshot.match_id, command_id: command.command_id, status: 'accepted' };
          if (command.type === 'TABLE_CHAT_HISTORY') ack.messages = history;
          if (command.type === 'TABLE_CHAT_SEND') {
            const message = { type: 'TABLE_CHAT_MESSAGE', id: command.command_id, room_id: 'room', match_id: snapshot.match_id, sender_id: 'u0', sender_name: 'Host', text: command.payload.text, sent_at: Date.now() };
            history.push(message); ws.send(JSON.stringify(message)); ack.message = message;
          }
          ws.send(JSON.stringify(ack));
        });
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(site);
      const button = name => page.getByRole('button', { name, exact: true });
      await page.getByRole('button', { name: /Return to table/ }).first().tap();
      await page.getByTestId('game-social-controls').waitFor().catch(async error => {
        console.error(await page.locator('body').innerText(), errors);
        throw error;
      });
      for (let cycle = 0; cycle < 6; cycle++) {
        if (cycle % 2) {
          await button('Table menu').tap();
          await page.getByTestId(kind + '-menu-drawer').getByRole('button', { name: 'Table Chat', exact: true }).tap();
        } else await button('Table Chat').tap();
        const input = page.getByRole('textbox', { name: 'Table message', exact: true });
        await input.tap();
        await page.waitForTimeout(400);
        assert.ok(await input.evaluate(el => el === document.activeElement), `${kind} cycle ${cycle}: tapping must focus chat; active=${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 500))}`);
        await page.keyboard.type(`Message ${cycle}`);
        await button('Send table message').tap();
        await page.getByTestId('table-chat-messages').getByText(`Message ${cycle}`, { exact: true }).waitFor();
        await input.tap();
        await page.waitForTimeout(400);
        assert.ok(await input.evaluate(el => el === document.activeElement), 'tapping after send must focus chat');
        await page.keyboard.type('Draft');
        if (kind === 'flush' && cycle === 2) {
          snapshot.flush.public.round_number += 1;
          snapshot.flush.public.settlement = { winner_ids: ['1'], payouts: [], shown_hands: [] };
        }
        if (kind === 'marriage' && cycle === 2) {
          snapshot.marriage.public.players[1].initial_tunnelas = [{ meld_type: 'tunnela', card_ids: ['D0:5H', 'D1:5H', 'D2:5H'] }];
        }
        await page.waitForTimeout(1200); // Include snapshot polling while editing.
        if (kind === 'marriage' && cycle === 2) await page.waitForTimeout(7000); // Announcements must not expire unseen behind chat.
        assert.equal(await input.inputValue(), 'Draft');
        assert.ok(await input.evaluate(el => el === document.activeElement), 'snapshot polling must preserve focus');
        await input.fill('');
        await button('Close table chat').tap();
        if (kind === 'flush' && cycle === 2) {
          await button('Close final show').tap();
          snapshot.flush.public.settlement = null;
        }
        if (kind === 'marriage' && cycle === 2) {
          await page.getByTestId('marriage-announcement').waitFor();
          await button('Close table announcement').tap();
        }
      }
      assert.equal(history.length, 6);
      assert.deepEqual(gameplay, [], 'chat must not send gameplay commands');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${kind}: repeated touch open/send/reopen, menu transitions, focus during polling and automatic results/announcements`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
