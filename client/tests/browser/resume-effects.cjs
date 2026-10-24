// Foreground catch-up must restore state without a pile of historical effects.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8127';
async function visibility(page,hidden){await page.evaluate(hidden=>{
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
 document.dispatchEvent(new Event('visibilitychange'));
},hidden);}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,1280]){
  let initial;const messages=[];
  const f=await fixture(browser,'flush',4,width,false,s=>{s.flush.bets=[];s.flush.public.pot=20;initial=structuredClone(s);},messages);
  const p=f.page;await p.getByTestId('flush-arena').waitFor();
  // Let the initial read finish and establish the silent presentation baseline.
  await p.getByTestId('activity-line').waitFor({state:'hidden'});
  const poke=(id,text)=>({type:'ROOM_POKE',id,room_id:'room',match_id:initial.match_id,
   sender_id:'u1',sender_name:'Player 2',sender_player_id:2,recipient_id:null,
   recipient_player_id:null,scope:'table',text,expires_at:Date.now()+5000});
  f.emit(poke('live-before','before pause'));
  await p.getByText('before pause',{exact:true}).first().waitFor();
  await visibility(p,true);
  await p.getByText('before pause',{exact:true}).waitFor({state:'hidden'});
  f.change(s=>{s.game.revision+=3;s.flush.public.pot=26;s.flush.bets=[1,2,3].map(sequence=>({sequence,amount:2,player_id:'2',kind:'BET_PLACED'}));});
  f.emit(poke('missed','missed poke'));
  const chat={type:'TABLE_CHAT_MESSAGE',id:'missed-chat',room_id:'room',match_id:initial.match_id,
   sender_id:'u1',sender_player_id:2,sender_name:'Player 2',text:'saved missed chat',sent_at:Date.now()};
  messages.push(chat);f.emit(chat);
  // Delayed foreground reads must not re-arm effects using the old snapshot.
  let release;const gate=new Promise(resolve=>release=resolve);
  await p.route(site+'/test-games/room**',async route=>{await gate;await route.fallback();});
  await visibility(p,false);
  await p.getByTestId('activity-line').first().waitFor();
  assert.equal(await p.getByTestId('flush-coin-flight').count(),0);
  assert.equal(await p.getByText('missed poke',{exact:true}).count(),0);
  release();await p.getByTestId('flush-pot').getByText('Pot = 26',{exact:true}).waitFor();
  await p.getByTestId('activity-line').waitFor({state:'hidden'});
  assert.equal(await p.getByTestId('flush-coin-flight').count(),0);
  assert.equal(await p.getByText('missed poke',{exact:true}).count(),0);
  assert.equal(await p.getByText('saved missed chat',{exact:true}).count(),0,'no historical chat bubble');
  // A genuinely new foreground bet and poke still animate normally.
  f.change(s=>{s.game.revision++;s.flush.public.pot=28;s.flush.bets.push({sequence:4,amount:2,player_id:'2',kind:'BET_PLACED'});});
  await p.getByTestId('flush-coin-flight').waitFor();
  f.emit(poke('live-after','after resume'));
  await p.getByText('after resume',{exact:true}).first().waitFor();
  await p.screenshot({path:`/private/tmp/bhidne-resume-effects-${width}.png`});
  await p.getByRole('button',{name:/^Table Chat/i}).first().click();
  await p.getByTestId('table-chat-messages').getByText('saved missed chat',{exact:true}).waitFor();
  assert.deepEqual(f.errors,[]);await f.context.close();
  console.log(`PASS ${width}: cleared effects, silent catch-up pot, delayed read guard, new live bet and poke`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
