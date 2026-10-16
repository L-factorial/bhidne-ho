// Engine-generated completion, isolated HTTP snapshots, no live game/account writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const root=path.resolve(__dirname,'../../..');
const raw=JSON.parse(execFileSync(process.env.TEST_PYTHON||path.join(root,'.venv/bin/python'),['-c',`
import json,runpy
from dataclasses import asdict
from marriage import DrawSource
ns=runpy.run_path('tests/marriage/test_normal_completion.py')
g=ns['normal_round'](count=4,wild=True)
g.draw_card('0',DrawSource.STOCK)
g.show_initial_melds('0',ns['INITIAL'])
before=asdict(g.get_player_view('0'))
g.finish('0')
print(json.dumps({'before':before,'after':asdict(g.get_player_view('0'))}))
`],{cwd:root,encoding:'utf8'}));
function ids(value){if(Array.isArray(value))return value.map(ids);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,['player_id','current_player_id','winner'].includes(k)&&v!==null?String(Number(v)+1):ids(v)]));}
const views=ids(raw),out=process.env.SCREENSHOT_DIR||'/private/tmp/bhidne-marriage-results';fs.mkdirSync(out,{recursive:true});
function apply(s,view,finished){s.status=finished?'finished':'playing';s.marriage={public:view.public,private:{player_id:view.player_id,hand:view.hand,actions:view.actions,maal:view.maal},moves:[]};s.game.finished=finished;s.game.revision=view.public.revision;s.game.phase=finished?'FINISHED':'MUST_DISCARD';s.game.turn.player_id=1;}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,320,1280]){
  const f=await fixture(browser,'marriage',4,width,false,s=>apply(s,views.before,false)),{page}=f;
  const see=page.getByTestId('marriage-see-maal-step');if(await see.isVisible()){await page.getByTestId('marriage-see-maal-card').click();await see.getByRole('button',{name:'Continue',exact:true}).click();}
  const expanded=page.getByTestId('hand-attention-expanded');if(await expanded.isVisible())await expanded.click();await page.waitForTimeout(150);
  const before=await page.getByTestId('marriage-player-grid').boundingBox();
  f.change(s=>apply(s,views.after,true));await page.getByTestId('marriage-game-result').waitFor();
  assert.equal(await page.getByTestId('marriage-player-grid').count(),1);
  assert.equal(await page.getByRole('button',{name:'View winning hand',exact:true}).count(),0);
  assert.equal(await page.getByTestId('marriage-announcement').count(),0);
  const after=await page.getByTestId('marriage-player-grid').boundingBox();
  assert.ok(Math.abs(before.height-after.height)<=2,`table height changed ${before.height} -> ${after.height}`);
  await page.screenshot({path:`${out}/finished-table-${width}.png`});await page.getByTestId('marriage-game-result').click();
  const panel=page.getByTestId('marriage-details');await panel.getByRole('tab',{name:'Game results',exact:true}).waitFor();
  assert.equal(await panel.getByRole('tab').count(),6);
  const grid=await panel.getByRole('tablist').boundingBox();
  for(const tab of await panel.getByRole('tab').all()){const box=await tab.boundingBox();assert.ok(box.x>=grid.x-1 && box.x+box.width<=grid.x+grid.width+1);}
  assert.equal(await panel.getByRole('tablist').evaluate(node=>getComputedStyle(node).flexWrap),'wrap');
  await page.getByTestId('marriage-result-maal').waitFor();
  assert.equal(await panel.locator('[aria-label^="tiplu:"]').count(),1);
  assert.equal(await panel.locator('[aria-label^="jhiplu:"], [aria-label^="poplu:"]').count(),0);
  for(const label of ['Maal','Previously shown groups','Final winning combination'])assert.equal(await panel.getByText(label,{exact:true}).count(),1);
  await page.screenshot({path:`${out}/game-results-${width}.png`});
  await panel.getByText('Final winning combination',{exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:`${out}/winning-combination-${width}.png`});
  await panel.getByRole('tab',{name:'Points computation',exact:true}).click();await page.getByTestId('marriage-points').waitFor();for(const score of views.after.public.scores.players){for(const [index,amount] of [score.maal_net,score.winner_payment,score.net_points].entries())assert.equal(await page.getByTestId(`result-value-${score.player_id}-${index}`).innerText(),amount>0?'+'+amount:String(amount));}await page.screenshot({path:`${out}/points-${width}.png`});
  await panel.getByText('Maal breakdown',{exact:true}).first().evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:`${out}/maal-breakdown-${width}.png`});
  for(let i=1;i<=4;i++){
   const name='Player '+i+(i===1?' (You)':'');await panel.getByRole('tab',{name,exact:true}).click();
   const cards=views.after.public.final_hands.find(p=>p.player_id===String(i)).cards;
   for(const card of cards)assert.ok(await panel.locator(`[aria-label="${card.card_type==='man'?'Joker':({11:'J',12:'Q',13:'K',14:'A'}[card.rank]||card.rank)+({S:'♠',H:'♥',C:'♣',D:'♦'}[card.suit])}"]`).count()>0);
   await page.screenshot({path:`${out}/player-${i}-${width}.png`});
  }
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log(`PASS results ${width}: stable table, labeled Maal, six tabs, scores and all final hands`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
