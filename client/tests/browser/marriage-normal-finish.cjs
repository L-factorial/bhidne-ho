// Real engine-generated winning views; browser checks preview, privacy and submission.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const python = process.env.TEST_PYTHON || path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const fixtures = JSON.parse(execFileSync(python, ['-c', `
import json, runpy
from dataclasses import asdict
from marriage import DrawSource
ns = runpy.run_path('tests/marriage/test_normal_completion.py')
g = ns['normal_round'](wild=True)
g.draw_card('0', DrawSource.STOCK)
g.show_initial_melds('0', ns['INITIAL'])
before = asdict(g.get_player_view('0'))
g.finish('0')
print(json.dumps({'before': before, 'after': asdict(g.get_player_view('0'))}))
`], { cwd: root, encoding: 'utf8' }));
// Room seat IDs are one-based; the standalone fixture uses zero-based IDs.
function roomIds(value) {
  if (Array.isArray(value)) return value.map(roomIds);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    ['player_id', 'current_player_id', 'winner'].includes(key) && item !== null ? String(Number(item) + 1) : roomIds(item)]));
}
const views = roomIds(fixtures);
const button = (page, name) => page.getByRole('button', { name, exact: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const room = { room_id: `normal-${width}`, name: 'Normal Marriage', members: ['u0', 'u1'] };
      await context.addInitScript(room => sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',
        JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: 'marriage' })), room);
      let finished = false, attempts = 0;
      const commands = [];
      function snapshot() {
        const view = structuredClone(finished ? views.after : views.before);
        return { room_id: room.room_id, match_id: 'normal1', game_type: 'marriage', capacity: 2,
          is_creator: true, can_join: false, your_player_id: 1,
          players: room.members.map((user_id, i) => ({ user_id, player_id: i + 1, display_name: `Player ${i + 1}`, connected: true })),
          status: finished ? 'finished' : 'playing', game: { revision: view.public.revision, finished,
            phase: 'MUST_DISCARD', winners: finished ? [1] : [], turn: { player_id: 1 }, current_trick: null, scores_tenths: [] },
          marriage: { public: view.public, private: { player_id: view.player_id, hand: view.hand, actions: view.actions, maal: view.maal } } };
      }
      await context.route('http://localhost:8000/**', async route => {
        const url = new URL(route.request().url());
        let body = url.pathname.startsWith('/test-games/') ? snapshot() : url.pathname === '/rooms' ? [room] : [];
        if (url.pathname.endsWith('/action')) {
          const command = route.request().postDataJSON(); commands.push(command);
          assert.equal(command.command, 'FINISH');
          assert.deepEqual(command.payload, {});
          assert.equal(command.expected_revision, views.before.public.revision);
          attempts++;
          if (attempts === 1) {
            await route.fulfill({ status: 422, json: { detail: 'Test rejection: try again.' } }); return;
          }
          finished = true;
          body = { ...snapshot(), action_ack: { command_id: command.command_id, status: 'accepted', revision: views.after.public.revision } };
        }
        await route.fulfill({ json: body });
      });
      await context.routeWebSocket('ws://localhost:8000/**', ws => {
        ws.send(JSON.stringify({ type: 'CONNECTED' })); ws.onMessage(() => ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' })));
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.TEST_WEB_URL || 'http://localhost:8083');
      await button(page, 'Finish round').waitFor();
      const guidance = page.getByTestId('marriage-discard-guidance');
      async function pulseRange(cue) {
        const values = [];
        for (let i = 0; i < 6; i++) {
          values.push(await cue.evaluate(el => Number(getComputedStyle(el).opacity)));
          await page.waitForTimeout(200);
        }
        return Math.max(...values) - Math.min(...values);
      }
      await guidance.waitFor();
      assert.ok(await pulseRange(guidance.getByTestId('action-cue')) > 0.03, 'discard selection guidance pulses');
      if (width < 900) {
        await button(page, 'Collapse your card area').click();
        await guidance.waitFor({ state: 'hidden' });
        await page.getByText('Your turn · Select card to discard', { exact: true }).waitFor();
        await button(page, 'Expand your card area').click();
        await guidance.waitFor();
        assert.ok(await pulseRange(guidance.getByTestId('action-cue')) > 0.03, 'reopening the hand restarts selection guidance');
      }
      const firstCard = page.getByTestId('marriage-hand').getByRole('button').first();
      await firstCard.click();
      const secondCard = page.getByTestId('marriage-hand').getByRole('button').nth(1);
      await secondCard.click();
      assert.equal(await firstCard.getAttribute('aria-pressed'), 'false');
      assert.equal(await secondCard.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByTestId('marriage-hand').locator('[aria-pressed="true"]').count(), 1, 'only the last tapped discard remains selected');
      await firstCard.click();
      await guidance.waitFor({ state: 'hidden' });
      await page.getByText('Your turn · Confirm discard', { exact: true }).waitFor();
      assert.ok(await pulseRange(page.getByRole('button', { name: /^Discard / }).getByTestId('action-cue')) > 0.03, 'selected discard action pulses');
      await firstCard.click();
      await guidance.waitFor();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.ok(await pulseRange(guidance.getByTestId('action-cue')) < 0.01, 'Reduce Motion stops selection pulsing');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.equal(commands.length, 0);
      await button(page, 'Hide cards').click();
      await guidance.waitFor({ state: 'hidden' });
      assert.equal(await button(page, 'Finish round').isDisabled(), true);
      await button(page, 'Show cards').click();
      await button(page, 'Finish round').click();
      const preview = page.getByTestId('marriage-finish-preview');
      await preview.waitFor();
      await preview.getByText('Final discard:', { exact: false }).waitFor();
      const rect = await preview.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1);
      assert.equal(commands.length, 0, 'review must not finish automatically');
      await button(page, 'Close winning preview').click();
      await preview.waitFor({ state: 'hidden' });
      await button(page, 'Finish round').click();
      await button(page, 'Confirm finish').click();
      await preview.getByRole('alert').getByText('Test rejection: try again.', { exact: false }).waitFor();
      assert.equal(await preview.isVisible(), true, 'rejected finish keeps the preview open');
      await button(page, 'Confirm finish').click();
      await preview.waitFor({ state: 'hidden' });
      await page.getByText('Player 1 wins!', { exact: true }).waitFor();
      await page.getByText('Normal hand complete. Ready for another round?', { exact: true }).waitFor();
      await button(page, 'View winning hand').click();
      await page.getByTestId('marriage-winning-hand').waitFor();
      await page.getByTestId('marriage-points').waitFor();
      assert.equal(commands.length, 2);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: normal winning preview, hidden-card privacy, rejection/retry, finish and points at mobile and desktop widths.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
