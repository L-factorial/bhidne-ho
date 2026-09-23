const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8098';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const snapshot=JSON.parse(fs.readFileSync('/tmp/bhidne-social-marriage.json'));
  const room={room_id:'room',name:'Marriage fold',members:['u0','u1','u2','u3']};
  const pub=snapshot.marriage.public,mine=snapshot.marriage.private;
  pub.current_player_id='2';pub.phase='must_draw';snapshot.game.turn.player_id=2;
  mine.actions.kinds=['fold'];mine.actions.discardable_card_ids=[];mine.actions.drawable_sources=[];
  const ctx=await browser.newContext({viewport:{width,height:900}});
  await ctx.addInitScript(({site,room})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'mock'},room,game:'marriage'})),{site,room});
  const commands=[];
  await ctx.route(site+'/**',async r=>{
   const path=new URL(r.request().url()).pathname;
   if(path==='/'||path.startsWith('/_expo/')||path.startsWith('/assets/')||path==='/favicon.ico')return r.continue();
   let data=path==='/rooms'?[room]:[];
   if(path.startsWith('/test-games/')){
    if(path.endsWith('/action')){
     const cmd=r.request().postDataJSON();commands.push(cmd);assert.equal(cmd.command,'FOLD');
     pub.players.find(p=>p.player_id==='1').folded=true;mine.actions.kinds=[];
     pub.revision++;snapshot.game.revision=pub.revision;
     snapshot.action_ack={match_id:snapshot.match_id,command_id:cmd.command_id,status:'accepted',revision:pub.revision};
    }data=snapshot;
   }await r.fulfill({json:data});
  });
  await ctx.routeWebSocket(site.replace('http','ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
  const page=await ctx.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(site);await page.getByRole('button',{name:/Return to table/}).first().click();
  const btn=name=>page.getByRole('button',{name,exact:true});
  if(width<900)await btn('Expand your card area').click();
  await btn('Fold').click();assert.equal(commands.length,0);
  await btn('Keep playing').click();assert.equal(commands.length,0);
  await btn('Fold').click();await btn('Confirm fold').click();
  await page.getByText('Folded · Watching this round',{exact:true}).waitFor();
  assert.equal(await btn('Fold').count(),0);assert.equal(commands.length,1);
  assert.equal(pub.current_player_id,'2');
  assert.deepEqual(errors,[]);await ctx.close();
 }console.log('PASS: fold while off-turn and cards hidden, confirmation/cancel, folded spectator state on mobile and desktop.');}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
