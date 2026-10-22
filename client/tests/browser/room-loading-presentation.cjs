// Exported app with isolated responses only; no live accounts or writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:844}});
   const page=await context.newPage();page.setDefaultTimeout(10000);
   const room={room_id:'room',name:'Loading room',creator_id:'u0',members:['u0'],connected_members:['u0'],is_member:true};
   const readyView={room_id:'room',status:'empty',tables:width===1280?[{match_id:'fixture-table',name:'Table-1',game_type:'callbreak',status:'waiting',phase:'OPEN',players:1,capacity:4,current_user:{is_seated:false,can_join:true},seated_players:[{seat_id:1,display_name:'Sigma'}]}]:[]};
   const ready=page.getByTestId(width===1280?'table-card-fixture-table':'room-empty-tables');
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await context.addInitScript(({site,room})=>{
    localStorage.setItem('bhidne.language','en');
    sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'},room,game:'callbreak'}));
   },{site,room});
   let release,mode='delayed';const gate=new Promise(resolve=>release=resolve);
   await context.route(site+'/**',async route=>{
    const request=route.request(),p=new URL(request.url()).pathname;
    if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
    let body=[];
    if(p.startsWith('/test-games/room')){
     if(mode==='delayed')await gate;
     if(mode==='failure')return route.fulfill({status:503,json:{detail:'Table service temporarily unavailable.'}});
     body=readyView;
    }else if(p==='/rooms')body=[room];
    else if(p==='/rooms/room'||p==='/rooms/room/enter')body=room;
    else if(p==='/auth/me')body={user_id:'u0',username:'ekraj',display_name:'Ekraj'};
    else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',muted_until:null};
    else if(p==='/friends')body={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
    else if(p==='/auth/safety/capabilities')body={blocking:false,reporting:false};
    await route.fulfill({json:body});
   });
   await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{
    ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(raw=>{if(JSON.parse(raw).type==='HEARTBEAT')ws.send(JSON.stringify({type:'HEARTBEAT_ACK'}));});
   });
   await page.goto(site);
   const loader=page.getByTestId('room-tables-loading');await loader.waitFor();
   assert.equal(await page.getByRole('button',{name:'Create game',exact:true}).count(),0);
   await loader.getByTestId('activity-line').waitFor();
   assert.equal(await page.getByText('Updating game…',{exact:true}).count(),0);
   mode='ready';release();await ready.waitFor();
   await loader.waitFor({state:'hidden'});await page.getByRole('button',{name:'Create game',exact:true}).waitFor();
   mode='failure';await page.reload();await loader.waitFor();
   // Let several retries run: transport failures must never become a red alert.
   await page.waitForTimeout(3500);
   await loader.getByTestId('activity-line').waitFor();
   assert.equal(await page.getByRole('button',{name:'Retry loading tables',exact:true}).count(),0);
   assert.equal(await page.getByRole('alert').count(),0);
   mode='ready';await ready.waitFor();await loader.waitFor({state:'hidden'});
   assert.deepEqual(errors,[]);
   await context.close();console.log(`PASS ${width}px: fading line during load/outage, automatic recovery without error flash`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
