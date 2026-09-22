const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path, user, body) {
  const r = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
const marriage = JSON.parse(execFileSync('.venv/bin/python', ['-c', `import json, runpy
from dataclasses import asdict
from marriage import DrawSource
ns=runpy.run_path('tests/marriage/test_normal_completion.py')
g=ns['normal_round'](wild=True)
g.draw_card('0', DrawSource.STOCK)
g.show_initial_melds('0', ns['INITIAL'])
g.finish('0')
print(json.dumps(asdict(g.get_player_view('0'))))`], { encoding: 'utf8' }));
function ids(value) {
  if (Array.isArray(value)) return value.map(ids);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, ['player_id','winner','current_player_id'].includes(key) && val !== null ? String(Number(val) + 1) : ids(val)]));
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const kind of ['callbreak', 'marriage']) {
      const user = await api('/auth/signup', null, { username: `result_${kind}_${Date.now()}`, display_name: 'Prajwal', password: 'Results-test-123' });
      const room = await api('/rooms', user, { name: 'Results test' });
      const root = `/test-games/${room.room_id}`;
      const base = await api(root, user, { game_type: kind, player_count: kind === 'marriage' ? 2 : 4 });
      const count = kind === 'marriage' ? 2 : 4;
      const players = Array.from({length:count}, (_, i) => ({ player_id:i+1, user_id:i ? `fixture-${i}` : user.user_id, display_name:['Prajwal','Sita Rai','Amit','Sujan'][i], connected:true,
        avatar_url: i === 0 ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' : i === 1 ? `${site}/missing-test-avatar.png` : undefined }));
      const snapshot = { ...base, players, status:'finished', game:{ revision:100, phase:'FINISHED', finished:true,winners:[1],turn:{player_id:null},current_trick:null,scores_tenths:[30,-10,-20,30] }, your_player_id:1 };
      if (kind === 'callbreak') {
        const results = players.map((p,i) => ({player_id:p.player_id,bid:3,tricks_won:i===1?2:3,score_tenths:i===1?-30:30,cards_remaining:0}));
        snapshot.deal = {deal_number:5,attempt:1,dealer:1,tricks_completed:13,tricks_required:13,tricks:[],players:results};
        snapshot.deal_history=[{deal_number:5,complete:true,players:results}];
        snapshot.scoreboard=results.map(p=>({player_id:p.player_id,total_score_tenths:p.score_tenths,deal_scores_tenths:[p.score_tenths]}));
        snapshot.private={hand:[],legal_cards:[],can_accept_hand:false,can_claim_redeal:false};
      } else { const view=ids(marriage); snapshot.marriage={public:view.public,private:{player_id:view.player_id,hand:view.hand,actions:view.actions,maal:view.maal}}; }
      const page = await browser.newPage({viewport:{width:390,height:844}}), errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({user,room,site,kind})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user,room,game:kind})),{user,room,site,kind});
      await page.route(site+root+'**',route=>route.fulfill({json:snapshot}));
      await page.goto(site);
      await page.getByRole('button',{name:/^Return to table ·/}).click();
      const results=page.getByTestId('round-results-table').first(); await results.waitFor();
      await page.waitForTimeout(350); // Finish the existing game modal fade before screenshots.
      assert.equal(await results.getByTestId(/^result-player-/).count(),count);
      await results.getByLabel('Anonymous player profile').first().waitFor();
      assert.equal(await results.getByLabel('Player photo').count(),1);
      for (const width of [320,390,1280]) {
        await page.setViewportSize({width,height:900});
        const bounds=await results.boundingBox(); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
        await page.screenshot({path:`/tmp/results-${kind}-${width}.png`,fullPage:true});
      }
      assert.deepEqual(errors,[]); await page.close();
      console.log(`PASS ${kind}: results columns, photos, missing/broken avatar fallback and responsive layout`);
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
