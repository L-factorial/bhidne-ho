// Isolated snapshots only. Capture review states and verify actual drag/tab behavior.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const out=process.env.SCREENSHOT_DIR||'/private/tmp/bhidne-marriage-layout';
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${({11:'J',12:'Q',13:'K',14:'A'})[rank]||rank}${suit}`,card_type:'standard',rank,suit,deck_index:deck});
const qualifying=[...[2,3,4,5,6].map(r=>card(r,'S')),...[8,9,10,11,12].map(r=>card(r,'H')),...[0,1,2].map(d=>card(9,'D',d)),...[2,4,6,8,10,12,14].map(r=>card(r,'C')),card(2,'D')];
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const winning=JSON.parse(execFileSync(process.env.TEST_PYTHON||path.join(root,'.venv/bin/python'),['-c',`
import runpy,json
from dataclasses import asdict
from marriage import DrawSource
ns=runpy.run_path('tests/marriage/test_normal_completion.py')
g=ns['normal_round'](wild=True)
g.draw_card('0',DrawSource.STOCK)
g.show_initial_melds('0',ns['INITIAL'])
print(json.dumps(asdict(g.get_player_view('0'))))
`],{cwd:root,encoding:'utf8'}));
const ordinary=[...[4,5,6,7,12].map(r=>card(r,'S')),...[14,4,9,11].map(r=>card(r,'H')),card(11,'H',1),card(13,'H'),...[14,3,6,7,10,12].map(r=>card(r,'C')),...[4,6,13].map(r=>card(r,'D')), {card_id:'MAN:0',card_type:'man',rank:null,suit:null,deck_index:0}];
const ids=page=>page.getByTestId('marriage-hand').getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.dataset.testid).filter(id=>id?.startsWith('marriage-hand-card-')));
async function drag(page){const cards=page.getByTestId('marriage-hand').getByRole('button');const a=await cards.nth(0).boundingBox(),b=await cards.nth(2).boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.mouse.up();await page.waitForTimeout(350);}
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const cases=[['two-players',2,'draw',false,false],['three-players',3,'draw',false,false],['four-players',4,'draw',false,false],['five-players',5,'draw',false,false],['six-players',6,'draw',false,false],['maal-eligible',4,'draw',false,true],['discard',4,'discard',false,false],['waiting',4,'waiting',false,false],['after-maal',4,'draw',true,false],['marriage-eligible',4,'discard',true,true]];
 for(const width of (process.env.SCREENSHOT_WIDTHS||'390,320,1280').split(',').map(Number))for(const [title,count,phase,seen,eligible] of cases.filter(c=>!process.env.SCREENSHOT_CASE||c[0]===process.env.SCREENSHOT_CASE)){
  const f=await fixture(browser,'marriage',count,width,false,s=>{
   const pub=s.marriage.public,mine=s.marriage.private;
   pub.current_player_id=phase==='waiting'?'2':'1';pub.phase=phase==='discard'?'must_discard':'must_draw';pub.tunnela_declaration_pending=false;
   for(const p of pub.players){p.route='unqualified';p.has_seen_maal=false;p.shown_melds=[];p.initial_tunnelas=[];p.tunnela_declared=true;}
   mine.hand=structuredClone(eligible?qualifying:ordinary);mine.maal=null;
   if(seen){pub.players[0].has_seen_maal=true;pub.players[0].route='normal';mine.maal={tiplu:card(7,'D'),jhiplu:card(6,'D'),poplu:card(8,'D')};
    if(eligible){mine.hand=winning.hand;mine.maal=winning.maal;pub.players[0].shown_melds=winning.public.players[0].shown_melds;}

    else {pub.players[0].shown_melds=[{meld_type:'sequence',card_ids:ordinary.slice(0,3).map(c=>c.card_id)}];}
   }
   if(phase==='discard'&&!eligible)mine.hand.push(card(2,'H'));
   pub.players[0].hand_count=mine.hand.length;if(seen)pub.maal_selected=true;
   mine.actions={kinds:phase==='waiting'?['fold']:[phase==='discard'?'discard':'draw','fold',...(eligible?seen?['finish']:['show_initial_melds']:[])],drawable_sources:phase==='draw'?['stock','discard']:[],discardable_card_ids:mine.hand.map(c=>c.card_id),blocked_sources:[]};
   s.game.turn.player_id=phase==='waiting'?2:1;
  });const {page}=f;
  const modal=page.getByTestId('marriage-see-maal-step');if(await modal.isVisible()){await page.getByTestId('marriage-see-maal-card').click();await modal.getByRole('button',{name:'Continue',exact:true}).click();}
  const closed=page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();
  await page.getByTestId(seen?'marriage-win-eligibility':'marriage-maal-eligibility').waitFor();await page.waitForTimeout(500);
  assert.equal(await page.getByRole('button',{name:seen?(eligible?'Marriage eligible':'Marriage ineligible'):(eligible?'Maal eligible':'Maal ineligible'),exact:true}).count(),1);
  assert.equal(await page.getByTestId('marriage-view-tabs').count(),seen?0:1);
  assert.equal(await page.getByRole('tab',{name:'Dublee',exact:true}).count(),!seen&&count>=4?1:0);
  assert.equal(await page.getByTestId('marriage-drawn-card').count(),0);
  assert.equal(await page.getByTestId(seen?'marriage-maal-eligibility':'marriage-win-eligibility').count(),0);
  const actions=page.getByTestId('marriage-hand-actions');await actions.scrollIntoViewIfNeeded();
  const cards=page.getByTestId('marriage-hand').locator('[data-testid^="marriage-hand-card-"]');
  const last=await cards.last().boundingBox(),actionBox=await actions.boundingBox();
  if(await cards.count()===21){assert.ok(actionBox.x>last.x);assert.ok(actionBox.y<last.y+last.height);}
  else assert.ok(actionBox.y>=last.y+last.height);
  const status=page.getByTestId('marriage-header-status');
  assert.ok((await status.boundingBox()).height<=20);
  assert.equal(await status.evaluate(node=>getComputedStyle(node).textAlign),'center');
  assert.ok(await page.getByTestId('marriage-turn-dot').isVisible());
  if(phase!=='waiting'){
   const outline=page.getByTestId(width<900?'marriage-mobile-hand':'marriage-desktop-hand').getByTestId('hand-area-outline');
   const style=await outline.evaluate(node=>({left:getComputedStyle(node).left,shadow:getComputedStyle(node).boxShadow}));
   assert.equal(style.left,'6px');assert.ok(style.shadow.includes('inset'));
   await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('[data-testid="'+(innerWidth<900?'marriage-mobile-hand':'marriage-desktop-hand')+'"] [data-testid="hand-area-outline"]')).opacity)>.95);
  }
  assert.ok((await page.getByTestId('marriage-hand-draw').boundingBox()).height<=130);
  assert.ok((await page.getByTestId('marriage-hand-controls').boundingBox()).height<=54);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(title==='four-players')assert.deepEqual(await ids(page),ordinary.map(c=>'marriage-hand-card-'+c.card_id));
  await page.screenshot({path:`${out}/${title}-${width}.png`});
  if(title==='discard'){
   await cards.last().click();await page.getByTestId('marriage-discard-action').waitFor();
   await page.screenshot({path:`${out}/selected-discard-${width}.png`});await cards.last().click();
  }
  if(title==='maal-eligible'||title==='marriage-eligible'){
   await page.getByTestId(seen?'marriage-win-eligibility':'marriage-maal-eligibility').getByRole('button').click();
   await page.getByTestId(seen?'marriage-win-preview':'marriage-maal-preview').waitFor();
   await page.screenshot({path:`${out}/${seen?'marriage':'maal'}-preview-${width}.png`});
   if(seen)await page.getByRole('button',{name:'Back to your cards',exact:true}).click();else await page.getByTestId('marriage-maal-overlay').getByRole('button',{name:'Close details',exact:true}).click();
  }
  if(title==='four-players'){
   const original=await ids(page);await drag(page);const reordered=await ids(page);assert.notDeepEqual(reordered,original);
   await page.getByRole('tab',{name:'Sequence / Tunnela',exact:true}).click();const sorted=await ids(page);await drag(page);assert.deepEqual(await ids(page),sorted);
   await page.screenshot({path:`${out}/sequence-view-${width}.png`});
   await page.getByRole('tab',{name:'Dublee',exact:true}).click();const pairs=await ids(page);await drag(page);assert.deepEqual(await ids(page),pairs);
   await page.screenshot({path:`${out}/dublee-view-${width}.png`});
   await page.getByRole('tab',{name:'Your view',exact:true}).click();assert.deepEqual(await ids(page),reordered);
   await page.getByRole('button',{name:'Hide cards',exact:true}).click();await page.screenshot({path:`${out}/hidden-cards-${width}.png`});
   await page.getByRole('button',{name:'Show cards',exact:true}).click();
   await page.getByRole('button',{name:'Fold',exact:true}).click();await page.screenshot({path:`${out}/fold-confirmation-${width}.png`});
  }
  if(title==='after-maal'){const before=await ids(page);await drag(page);assert.notDeepEqual(await ids(page),before);}
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS',title,width);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
