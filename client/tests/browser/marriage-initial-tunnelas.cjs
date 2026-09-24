const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8098';
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${rank}${suit}`,rank,suit,deck_index:deck,card_type:'standard'});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const hasTunnela of [true,false])for(const width of [390,1280]){
  const snapshot=JSON.parse(fs.readFileSync('/tmp/bhidne-social-marriage.json'));
  const pub=snapshot.marriage.public,mine=snapshot.marriage.private;
  const room={room_id:'room',name:'Initial Tunnelas',members:['u0','u1','u2','u3']};
  pub.phase='must_draw';pub.current_player_id='2';pub.tunnela_declaration_pending=true;
  pub.players.forEach(p=>{p.tunnela_declared=false;p.initial_tunnelas=[];p.shown_melds=[];p.has_seen_maal=false;p.route='unqualified';});
  mine.hand=hasTunnela?[8,9].flatMap(rank=>[0,1,2].map(d=>card(rank,'H',d))).concat(Array.from({length:13},(_,i)=>card(i+2,'S')),card(2,'C'),card(3,'C'))
    :Array.from({length:13},(_,i)=>card(i+2,'S')).concat(Array.from({length:8},(_,i)=>card(i+2,'C')));
  mine.actions={kinds:['declare_tunnelas'],drawable_sources:[],discardable_card_ids:[],blocked_sources:[]};
  const commands=[];let reject=hasTunnela;
  const ctx=await browser.newContext({viewport:{width,height:900},hasTouch:true});
  await ctx.addInitScript(({site,room})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'mock'},room,game:'marriage'})),{site,room});
  await ctx.route(site+'/**',async r=>{
   const path=new URL(r.request().url()).pathname;
   if(path==='/'||path.startsWith('/_expo/')||path.startsWith('/assets/')||path==='/favicon.ico')return r.continue();
   if(path.endsWith('/action')){
    const cmd=r.request().postDataJSON();commands.push(cmd);assert.equal(cmd.command,'DECLARE_TUNNELAS');
    if(reject)return r.fulfill({status:409,json:{detail:'Please review and retry.'}});
    const own=pub.players.find(p=>p.player_id===mine.player_id);own.tunnela_declared=true;own.initial_tunnelas=cmd.payload.melds;
    mine.actions.kinds=[];pub.revision++;snapshot.game.revision=pub.revision;
    snapshot.action_ack={match_id:snapshot.match_id,command_id:cmd.command_id,status:'accepted',revision:pub.revision};
   }
   await r.fulfill({json:path.startsWith('/test-games/')?snapshot:path==='/rooms'?[room]:[]});
  });
  await ctx.routeWebSocket(site.replace('http','ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
  const page=await ctx.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(site);await page.getByRole('button',{name:/Return to table/}).first().click();
  const btn=name=>page.getByRole('button',{name,exact:true});
  assert.equal(await btn('Reveal cards').count(),0);
  await btn('Hide cards').click();
  assert.ok(await btn('Reveal cards to check Tunnela').isDisabled());
  assert.ok(await btn('Fold').isDisabled());
  await btn('Show cards').click();
  assert.equal(await page.getByTestId('marriage-maal-eligibility').count(),0);
  assert.equal(await page.getByTestId('marriage-hand-draw').count(),0);
  if(hasTunnela){
    await btn('Tunnela detected · Choose to show').click();
    await page.getByRole('checkbox',{name:'Tunnela 2',exact:true}).click();
    await btn('Show selected Tunnelas').click();
    await page.getByText('Please review and retry.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('checkbox',{name:'Tunnela 2',exact:true}).getAttribute('aria-checked'),'false');
    reject=false;await btn('Show selected Tunnelas').click();
    await btn('Close table announcement').click();
    assert.equal(commands.at(-1).payload.melds.length,1);
  }else{
    await btn('No Tunnela · Declare none').click();
    await page.getByTestId('marriage-tunnela-detector').waitFor({state:'detached'});
    assert.deepEqual(commands.at(-1).payload.melds,[]);
  }
  await page.getByTestId('marriage-tunnela-detector').waitFor({state:'detached'});
  await page.getByText('Declaration recorded · waiting for other players.',{exact:true}).waitFor();
  await page.getByTestId('marriage-maal-eligibility').waitFor();
  pub.tunnela_declaration_pending=false;pub.current_player_id=mine.player_id;pub.players.forEach(p=>p.tunnela_declared=true);
  mine.actions.kinds=['draw'];mine.actions.drawable_sources=['stock'];pub.revision++;snapshot.game.revision=pub.revision;
  await btn('Expand your card area').waitFor();await btn('Expand your card area').click({position:{x:20,y:20}});
  await page.getByTestId('marriage-hand-draw').waitFor();
  assert.deepEqual(errors,[]);await ctx.close();
  console.log(`PASS initial Tunnela ${hasTunnela?'selection':'none'} at ${width}px`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
