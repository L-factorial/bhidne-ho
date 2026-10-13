// Bundled web export, isolated routes and no live users or mutations.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
const waiting=require('../fixtures/join-after-marriage.json').after;
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const [flow,width,height] of [['play',320,740],['create',390,844],['play',1280,900],['create',844,390]]){
   const context=await browser.newContext({viewport:{width,height}});
   const page=await context.newPage();page.setDefaultTimeout(12000);
   const errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));
   const snapshot=structuredClone(waiting);snapshot.room_id='room';
   const room={room_id:'room',name:'Fixture room',creator_id:'u1',members:['u0','u1'],connected_members:['u0','u1'],is_member:true};
   let releaseRoom,releaseTable;
   const roomGate=new Promise(resolve=>releaseRoom=resolve),tableGate=new Promise(resolve=>releaseTable=resolve);
   await context.addInitScript(site=>{
    localStorage.setItem('bhidne.language','en');
    sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u1',token:'fixture'},room:null,game:null}));
   },site);
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),p=url.pathname;
    if(url.origin!==site)return route.abort();
    if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
    let body=[];
    if(request.method()!=='GET')writes.push(p);
    if(p==='/auth/me')body={user_id:'u1',username:'sigma',display_name:'Sigma'};
    else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',muted_until:null};
    else if(p==='/auth/safety/capabilities')body={blocking:false,reporting:false};
    else if(p==='/friends')body={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
    else if(p==='/rooms')body=[room];
    else if(p==='/rooms/room/enter'){if(flow==='play')await roomGate;body=room;}
    else if(p==='/rooms/room')body=room;
    else if(p==='/active-tables')body=flow==='play'?[{...snapshot.tables[0],room_id:'room',room_name:room.name}]:[];
    else if(p.startsWith('/test-games/room')){
     if(request.method()==='GET'){await tableGate;body=snapshot;}
     else{assert.equal(flow,'create');body={match_id:snapshot.match_id};}
    }
    await route.fulfill({json:body});
   });
   await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{
    ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(raw=>{if(JSON.parse(raw).type==='HEARTBEAT')ws.send(JSON.stringify({type:'HEARTBEAT_ACK'}));});
   });
   await page.goto(site);
   if(flow==='play')await page.getByRole('button',{name:/Return to table/}).first().click();
   else{
    await page.getByRole('button',{name:'Create game',exact:true}).first().click();
    await page.getByTestId('create-game-table').getByRole('button',{name:'Create game',exact:true}).click();
   }
   const transition=page.getByTestId('table-transfer');await transition.waitFor();
   const art=transition.getByTestId('table-transfer-art');await art.waitFor();
   await art.locator('img').waitFor();await art.locator('img').evaluate(img=>img.decode());
   const box=await art.boundingBox();
   assert.ok(box.width>0&&box.height>0&&box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height);
   const caption=transition.getByText('Taking you to your game table…',{exact:true});
   assert.equal(await caption.evaluate(el=>getComputedStyle(el).fontSize),'12px');
   releaseRoom();await transition.waitFor();
   if(flow==='create'&&width===390){fs.mkdirSync('/private/tmp/bhidne-table-transfer-preview',{recursive:true});await page.screenshot({path:'/private/tmp/bhidne-table-transfer-preview/390.png'});}
   releaseTable();await page.getByTestId('live-game-backdrop').waitFor();await transition.waitFor({state:'hidden'});
   assert.equal(writes.filter(p=>p==='/test-games/room').length,flow==='create'?1:0);
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${flow} ${width}x${height}: landing art, compact loader, immediate table handoff`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
