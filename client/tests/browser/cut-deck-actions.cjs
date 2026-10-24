// Local game snapshots; command responses are intentionally held for dedup checks.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const kind of (process.env.TEST_GAMES||'flush,callbreak').split(','))for(const action of ['auto','cut','skip']){
  const f=await fixture(browser,kind,4,390,false,s=>{
   s.game.phase='AWAITING_CUT';s.game.turn.player_id=s.your_player_id;
   if(kind==='callbreak'){s.private.hand=[];s.game.current_trick=null;s.deal.tricks=[];s.game.turn.action='CUT_DECK';}
   if(kind==='flush'){
    s.flush.public.status='awaiting_cut';s.flush.public.current_player_id=String(s.your_player_id);
    s.flush.private.actions.kinds=['cut_deck','skip_cut'];
   }
  }),p=f.page;
  const panel=p.getByTestId('cut-deck-actions');await panel.waitFor();await p.clock.install();
  const commands=[];
  await p.route('**/*',async r=>{if(r.request().method()==='POST'&&r.request().url().includes('/test-games/')){commands.push(r.request().postDataJSON());return;}return r.fallback();});
  await panel.getByRole('button',{name:'Cut deck',exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Cut deck',exact:true}).isEnabled(),true);await panel.getByRole('button',{name:'Skip',exact:true}).waitFor();
  if(action==='auto'){await p.clock.runFor(9000);assert.equal(commands.length,0);await p.clock.runFor(2100);}
  else await panel.getByRole('button',{name:action==='cut'?'Cut deck':'Skip',exact:true}).click();
  for(let i=0;commands.length===0&&i<10;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(commands.length,1);assert.match(JSON.stringify(commands[0]),action==='cut'?/CUT_DECK/:/SKIP_CUT/);
  await p.clock.runFor(12000);assert.equal(new Set(commands.map(command=>command.command_id||command.idempotency_key||JSON.stringify(command))).size,1,'only retries of the original command are allowed');
  assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind}: ${action}`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
