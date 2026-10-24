// Rendered local app controls; API responses are isolated fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const out=process.env.SCREENSHOT_DIR||'/private/tmp/bhidne-game-controls';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [320,390,1280])for(const kind of ['flush','marriage','callbreak']){
  let legal,marriageCard;
  const f=await fixture(browser,kind,4,width,false,s=>{
   s.game.turn.player_id=s.your_player_id;
   if(kind==='flush'){s.flush.public.current_player_id=String(s.your_player_id);s.flush.private.actions.kinds=['bet','fold','request_side_show'];}
   if(kind==='marriage'){s.marriage.public.current_player_id=String(s.your_player_id);s.marriage.public.phase='must_discard';s.marriage.private.actions.kinds=['discard','fold'];s.marriage.private.actions.discardable_card_ids=s.marriage.private.hand.map(c=>c.card_id);marriageCard=s.marriage.private.hand[0].card_id;}
   if(kind==='callbreak'){s.game.current_trick=null;s.deal.tricks=[];s.private.legal_cards=[s.private.hand[0]];legal=s.private.hand[0];}
  }),p=f.page;
  const collapsed=p.getByTestId('hand-attention-collapsed');if(await collapsed.isVisible())await collapsed.click();
  if(kind==='callbreak'){
   const flip=p.getByRole('button',{name:'Flip all cards',exact:true});if(await flip.isVisible())await flip.click();
   await p.getByRole('radio',{name:'Card grid',exact:true}).click();
   await p.getByTestId('callbreak-hand-card-'+legal).click();
   const play=p.getByRole('button',{name:'Play selected card',exact:true});await play.waitFor();assert.equal(await play.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(237, 196, 79)');
  }
  if(kind==='marriage'){
   const reveal=p.getByRole('button',{name:'Reveal cards',exact:true});if(await reveal.isVisible())await reveal.click();
   const card=p.getByTestId('marriage-hand-card-'+marriageCard);await card.waitFor();await card.click();
   const discard=p.getByTestId('marriage-discard-action');await discard.waitFor();assert.equal(await discard.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(237, 196, 79)');
  }
  if(kind==='flush')await p.getByTestId('flush-actions').getByRole('button',{name:/Bet minimum/}).waitFor();
  await p.waitForTimeout(250);await p.screenshot({path:`${out}/${kind}-${width}.png`});
  assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind} ${width}px`);
 }
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
