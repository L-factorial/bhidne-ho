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
const base=JSON.parse(require('node:fs').readFileSync('/tmp/bhidne-social-marriage.json'));
base.match_id='normal1';base.tables[0].match_id='normal1';base.active_game.game_id='normal1';
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
const button = (page, name) => page.getByRole('button', { name, exact: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const room = { room_id: `normal-${width}`, name: 'Normal Marriage', members: ['u0', 'u1'] };
      await context.addInitScript(({room,site}) => sessionStorage.setItem('bhidne.session.v1:'+site,
        JSON.stringify({ session: { user_id: 'u0', token: 'mock' }, room, game: 'marriage' })), {room,site});
      let finished = false, attempts = 0;
      const commands = [];
      function snapshot() {
        const view = structuredClone(finished ? views.after : views.before);
        return { ...base, room_id: room.room_id, match_id: 'normal1', game_type: 'marriage', capacity: 2,
          is_creator: true, can_join: false, your_player_id: 1,
          players: room.members.map((user_id, i) => ({ user_id, player_id: i + 1, display_name: `Player ${i + 1}`, connected: true })),
          status: finished ? 'finished' : 'playing', game: { revision: view.public.revision, finished,
            phase: 'MUST_DISCARD', winners: finished ? [1] : [], turn: { player_id: 1 }, current_trick: null, scores_tenths: [] },
          marriage: { public: view.public, private: { player_id: view.player_id, hand: view.hand, actions: view.actions, maal: view.maal } } };
      }
      await context.route(site+'/**', async route => {
        const url = new URL(route.request().url());
        if(url.pathname==='/'||url.pathname.startsWith('/_expo/')||url.pathname.startsWith('/assets/')||url.pathname==='/favicon.ico')return route.continue();
        let body = url.pathname.startsWith('/test-games/') ? snapshot() : url.pathname === '/rooms' ? [room] : [];
        if (url.pathname.endsWith('/action')) {
          const command = route.request().postDataJSON(); commands.push(command);
          assert.equal(command.command, 'FINISH');
          const ids=command.payload.melds.flatMap(g=>g.card_ids);
          assert.equal(ids.length,21);assert.equal(new Set(ids).size,21);
          assert.ok(!ids.includes(command.payload.discard_card_id));
          assert.equal(command.expected_revision, views.before.public.revision);
          attempts++;
          if (attempts === 1) {
            await route.fulfill({ status: 422, json: { detail: 'Test rejection: try again.' } }); return;
          }
          // Validate the exact selected option in the real engine, not just the mock UI.
          const after=JSON.parse(execFileSync(python,['-c',`
import json,runpy,sys
from dataclasses import asdict
from marriage import DrawSource,Meld,MeldType
ns=runpy.run_path('tests/marriage/test_normal_completion.py')
g=ns['normal_round'](wild=True);g.draw_card('0',DrawSource.STOCK);g.show_initial_melds('0',ns['INITIAL'])
p=json.loads(sys.argv[1]);g.finish('0',tuple(Meld(MeldType(m['meld_type']),tuple(m['card_ids'])) for m in p['melds']),p['discard_card_id'])
print(json.dumps(asdict(g.get_player_view('0'))))
`,JSON.stringify(command.payload)],{cwd:root,encoding:'utf8'}));
          views.after=roomIds(after);
          finished = true;
          body = { ...snapshot(), action_ack: { command_id: command.command_id, status: 'accepted', revision: views.after.public.revision } };
        }
        await route.fulfill({ json: body });
      });
      await context.routeWebSocket(site.replace('http','ws')+'/**', ws => {
        ws.send(JSON.stringify({ type: 'CONNECTED' })); ws.onMessage(() => ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' })));
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(site);
      await page.waitForTimeout(1200);
      if(await page.getByRole('button',{name:/Return to table/}).count())await page.getByRole('button',{name:/Return to table/}).first().click();
      await button(page,'Reveal cards').click();
      const eligible='Marriage eligible · Show Marriage';
      await button(page,eligible).waitFor();
      assert.equal(await page.getByRole('tab',{name:'Dublee',exact:true}).count(),0);
      assert.equal(await button(page,'Plan winning hand').count(),0);
      const firstCard=page.getByTestId('marriage-hand').getByRole('button').first();
      await firstCard.click();const selected=await firstCard.getAttribute('aria-label');
      await button(page,eligible).click();
      const preview=page.getByTestId('marriage-win-preview');await preview.waitFor();
      assert.equal(commands.length,0);
      assert.ok(await button(page,'Next option').isEnabled());
      await button(page,'Next option').click();
      await preview.getByText('Option 2 of',{exact:false}).waitFor();
      await button(page,'Previous option').click();
      await button(page,'Back to your cards').click();
      assert.equal(await page.getByTestId('marriage-hand').getByRole('button',{name:selected,exact:true}).getAttribute('aria-pressed'),'true');
      await button(page,'Hide cards').click();
      assert.ok(await button(page,'Reveal cards to check Marriage').isDisabled());
      await button(page,'Show cards').click();
      await button(page,eligible).click();
      await button(page,'Next option').click();
      await page.screenshot({path:`/tmp/marriage-win-${width}.png`});
      await button(page,'Show Marriage').click();
      await preview.getByText('Test rejection: try again.',{exact:true}).waitFor();
      assert.ok(await preview.isVisible());
      await button(page,'Show Marriage').click();
      await preview.waitFor({state:'hidden'});
      const announcement=page.getByTestId('marriage-announcement');await announcement.waitFor();
      await announcement.getByText('🏆 Round won!',{exact:true}).waitFor();
      await announcement.getByTestId('round-results-table').waitFor();
      await button(page,'Close table announcement').click();
      const resultButton=page.getByTestId('marriage-game-result');await resultButton.waitFor();
      await resultButton.click();
      const result=page.getByTestId('marriage-details');await result.waitFor();
      const resultText=await result.innerText();
      assert.ok(resultText.indexOf('Round complete!')<resultText.indexOf('How the points were calculated'));
      await result.getByText('Winning declaration',{exact:true}).waitFor();
      for(const player of views.after.public.scores.players)for(const item of player.items)assert.ok(item.card_ids.length);
      await page.screenshot({path:`/tmp/marriage-result-${width}.png`});
      await button(page,'Close details').click();
      assert.ok(await resultButton.isVisible());
      assert.deepEqual(commands[0].payload,commands[1].payload);
      assert.deepEqual(views.after.public.normal_finish,commands[1].payload);
      assert.equal(commands.length, 2);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: normal winning preview, hidden-card privacy, rejection/retry, finish and points at mobile and desktop widths.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
