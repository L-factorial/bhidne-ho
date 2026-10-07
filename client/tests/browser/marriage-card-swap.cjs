const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8099';
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${rank}${suit}`,rank,suit,deck_index:deck,card_type:'standard'});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390});
  const room={room_id:'swap-room',name:'Marriage swaps',members:['u0','u1']};
  const hand=[card(2,'H'),card(4,'H'),card(4,'H',1),card(3,'H'),...Array.from({length:13},(_,i)=>card(i+2,'S')),card(2,'C'),card(4,'C'),card(6,'C'),card(8,'C'),card(10,'C')];
  const snapshot={room_id:room.room_id,match_id:'swap-match',game_type:'marriage',capacity:2,is_creator:true,can_join:false,
   players:room.members.map((user_id,i)=>({user_id,player_id:i+1,display_name:`Player ${i+1}`,connected:true})),your_player_id:1,
   status:'playing',game:{revision:1,phase:'MUST_DISCARD',finished:false,winners:[],turn:{player_id:1},current_trick:null,scores_tenths:[]},
   tables:[{match_id:'swap-match',name:'Swap test',game_type:'marriage',status:'playing',phase:'STARTED',players:2,capacity:2,current_user:{is_seated:true}}],
   marriage:{public:{revision:1,status:'in_progress',current_player_id:'1',phase:'must_discard',stock_count:117,top_discard:null,winner:null,tunnela_declaration_pending:false,
    players:['1','2'].map(player_id=>({player_id,hand_count:22,route:'unqualified',shown_melds:[],initial_tunnelas:[],has_seen_maal:false,finished:false}))},
    private:{player_id:'1',hand,actions:{kinds:['discard'],drawable_sources:[],discardable_card_ids:hand.map(c=>c.card_id),blocked_sources:[]},maal:null}}};
  await context.addInitScript(({site,room})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'mock'},room,game:'marriage'})),{site,room});
  const commands=[];
  await context.route(site+'/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/'||path.startsWith('/_expo/')||path.startsWith('/assets/')||path==='/favicon.ico')return route.continue();
   if(path.endsWith('/action'))commands.push(route.request().postDataJSON());
   await route.fulfill({json:path.startsWith('/test-games/')?snapshot:path==='/rooms'?[room]:[]});
  });
  await context.routeWebSocket(site.replace('http','ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.goto(site);await page.getByRole('button',{name:/Return to table/}).first().click();
  const area=page.getByTestId('marriage-hand');await area.waitFor();await area.scrollIntoViewIfNeeded();
  const ids=()=>area.getByRole('button').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-testid').replace('marriage-hand-card-','')));
  const drawn=page.getByTestId('marriage-hand-card-'+hand.at(-1).card_id);
  assert.equal(await drawn.evaluate(node=>getComputedStyle(node).borderColor),'rgb(21, 128, 61)');
  assert.equal(await drawn.getByTestId('marriage-card-marker-drawn').count(),1);
  await drawn.click();
  assert.equal(await drawn.evaluate(node=>getComputedStyle(node).borderColor),'rgb(220, 38, 38)');
  assert.equal(await drawn.getByTestId('marriage-card-marker-discard').count(),1);
  await drawn.click();assert.equal(await drawn.getByTestId('marriage-card-marker-drawn').count(),1);
  for(const mode of ['Sequence / Tunnela','Dublee']){
   await page.getByRole('tab',{name:mode,exact:true}).click();await area.scrollIntoViewIfNeeded();
   const before=await ids(),source=area.getByRole('button').nth(0),target=area.getByRole('button').nth(width===390?8:2);
   const a=await source.boundingBox(),b=await target.boundingBox();
   if(width===390){
    const touch=await context.newCDPSession(page),start={x:a.x+a.width/2,y:a.y+a.height/2},end={x:b.x+b.width/2,y:b.y+b.height/2};
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
    for(let step=1;step<=15;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*step/15,y:start.y+(end.y-start.y)*step/15}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
   }else{
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:15});await page.mouse.up();
   }
   const expected=[...before];const targetIndex=width===390?8:2;[expected[0],expected[targetIndex]]=[expected[targetIndex],expected[0]];
   await page.waitForFunction(expected=>{
    const nodes=[...document.querySelector('[data-testid="marriage-hand"]').querySelectorAll('[role="button"]')];
    return JSON.stringify(nodes.map(n=>n.getAttribute('data-testid').replace('marriage-hand-card-','')))===JSON.stringify(expected);
   },expected);
   assert.equal(await area.locator('[aria-pressed="true"]').count(),0,'dragging must not select a discard');
   await page.getByRole('tab',{name:mode,exact:true}).click();assert.deepEqual(await ids(),before,'same arrangement button resets swaps');
   const first=area.getByRole('button').nth(0),second=area.getByRole('button').nth(1);
   await page.waitForTimeout(300);await first.click();assert.equal(await first.getAttribute('aria-pressed'),'true');await second.click();assert.deepEqual(await ids(),before,'taps select without swapping');
   assert.equal(await second.getAttribute('aria-pressed'),'true');await second.click();
  }
  await area.getByRole('button').first().click();
  await page.screenshot({path:`/private/tmp/bhidne-marriage-swap-${width}.png`});
  assert.deepEqual(commands,[],'presentation swaps do not send game commands');assert.deepEqual(errors,[]);
  console.log(`${width}px: drag swaps, arrangement reset, unchanged taps and green/red markers passed`);
  await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
