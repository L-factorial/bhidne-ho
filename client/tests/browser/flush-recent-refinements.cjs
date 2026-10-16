// Local snapshots and delayed responses only; no live accounts or games.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8119';
const proposal=(id,status)=>({id,status,proposer_name:'Player 1',voters:['u0','u1'],accepted:status==='ACCEPTED'?['u0','u1']:['u0'],can_vote:false,previous:{},proposed:{}});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 // Dirty-state controls, persisted limits and notices from authoritative snapshots.
 const f=await fixture(browser,'flush',4,390,false,s=>{
  s.status='waiting';s.rule_proposal=null;s.table.phase='OPEN';s.flush_settings.locked=false;s.flush_settings.rules.allow_raise=true;s.flush_settings.rules.max_raise=1;
 });const p=f.page;
 assert.equal(await p.getByText('Move player',{exact:true}).count(),0);
 const seats=p.getByTestId(/^move-seat-/);assert.equal(await seats.count(),4);
 let moved;await p.route(site+'/test-games/room/table/move-player',async r=>{moved=r.request().postDataJSON();await r.fulfill({status:409,json:{detail:'Fixture rejects move.'}});});
 const expanded=p.getByTestId('hand-attention-expanded');if(await expanded.isVisible())await expanded.click();
 await seats.nth(1).click();await seats.nth(2).click();
 for(let i=0;!moved&&i<100;i++)await p.waitForTimeout(25);assert.ok(moved);assert.equal(moved.user_id,'u1');

 await p.getByRole('button',{name:'Table menu',exact:true}).click();
 await p.getByTestId('flush-menu-drawer').getByRole('button',{name:'Game Config',exact:true}).click();
 const config=p.getByTestId('flush-rules-config');await config.waitFor();
 assert.equal(await config.getByRole('button',{name:'Revert changes',exact:true}).count(),0);
 await config.getByRole('tab',{name:'Bet values',exact:true}).click();
 assert.equal(await config.getByText('Allow raise',{exact:true}).count(),0);
 const limit=config.getByRole('textbox',{name:'Raise limit (1–5)',exact:true});assert.equal(await limit.inputValue(),'1');
 await limit.fill('3');await config.getByRole('button',{name:'Revert changes',exact:true}).click();assert.equal(await limit.inputValue(),'1');
 assert.equal(await config.getByRole('button',{name:'Revert changes',exact:true}).count(),0);
 f.change(s=>{s.flush_settings.rules.max_raise=2;s.flush_settings.rules_revision++;});
 await p.waitForFunction(()=>document.querySelector('input[aria-label="Raise limit (1–5)"]')?.value==='2');
 assert.equal(await config.getByRole('button',{name:'Revert changes',exact:true}).count(),0);
 await limit.fill('4');
 f.change(s=>{s.flush_settings.rules.max_raise=3;s.flush_settings.rules_revision++;});
 await config.getByRole('button',{name:'Load latest rules',exact:true}).click();assert.equal(await limit.inputValue(),'3');
 await limit.fill('4');let saved;
 await p.route(site+'/test-games/room/flush-settings',async r=>{
  saved=r.request().postDataJSON();f.change(s=>{s.flush_settings.rules=saved.rules;s.flush_settings.rules_revision++;s.rule_proposal=proposal('new-config','ACCEPTED');});
  // GET polling supplies the committed view; a temporary transport failure must retain the draft.
  await r.fulfill({status:503,json:{detail:'Retry save.'}});
 });
 await config.getByRole('button',{name:'Save config',exact:true}).click();
 await p.getByTestId('game-config-notice').waitFor();
 assert.equal(saved.rules.max_raise,4);assert.equal(saved.rules.allow_raise,true);
 await config.getByRole('button',{name:'Revert changes',exact:true}).waitFor({state:'hidden'});
 await config.getByRole('button',{name:'Close game rules config',exact:true}).click();
 assert.match(await p.getByTestId('game-config-notice').innerText(),/updated/i);
 f.change(s=>{s.rule_proposal=proposal('pending-config','PENDING');});
 await p.getByText('Rule changes proposed.',{exact:true}).waitFor();
 f.change(s=>{s.rule_proposal=proposal('pending-config','ACCEPTED');});
 await p.getByText('Game config updated for the next game.',{exact:true}).waitFor();
 assert.deepEqual(f.errors,[]);await f.context.close();
 console.log('PASS config limit, revert state, saved rules, proposal/acceptance notices');
 // SEE_CARDS must keep backs visible while the server is delayed or rejects it.
 let current;const g=await fixture(browser,'flush',4,390,false,s=>{
  s.flush.public.current_player_id='1';s.flush.public.players[0].visibility='blind';s.flush.private.cards=[];
  s.flush.private.actions.kinds=['bet','see_cards','fold'];s.flush.private.actions.raises_remaining=0;s.flush.private.actions.maximum_bet=s.flush.private.actions.required_bet;s.flush_settings.rules.allow_raise=true;current=s;
 });const page=g.page;let release,requests=0;
 await page.route(site+'/test-games/room**',async r=>{
  if(r.request().method()==='POST'){
   requests++;const body=r.request().postDataJSON();assert.equal(body.command,'SEE_CARDS');
   if(requests===1)return r.fulfill({status:503,json:{detail:'Retry reveal.'}});
   await new Promise(resolve=>{release=resolve;});
   current=structuredClone(current);current.game.revision++;current.flush.public.players[0].visibility='seen';current.flush.private.cards=['AS','7H','9C'];current.flush.private.actions.kinds=['bet','fold'];
   current.action_ack={command_id:body.command_id,status:'accepted',revision:current.game.revision};
  }
  return r.fulfill({json:current});
 });
 const actions=page.getByTestId('flush-actions');assert.equal(await actions.getByRole('button',{name:/Bet double/}).count(),0);
 const see=actions.getByRole('button',{name:'See cards',exact:true});await see.click();await page.waitForTimeout(350);
 assert.equal(await page.locator('[data-testid^="flush-card-front-"][aria-hidden="false"]').count(),0);
 // Retry the transport-level failure through the command client's recovery path.
 for(let i=0;!release&&i<100;i++)await page.waitForTimeout(50);assert.ok(release,'reveal retry reached server');
 assert.equal(await page.getByTestId('flush-card-front-0').innerText(),'');release();
 await page.getByTestId('flush-card-front-0').getByText('7',{exact:true}).waitFor();
 assert.match(await page.getByTestId('flush-card-front-0').innerText(),/7/);
 assert.deepEqual(g.errors,[]);await g.context.close();console.log('PASS no Double at cap; card backs survive delayed/retried reveal and flip only with ready faces');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
