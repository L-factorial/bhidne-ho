// Local distributed-original export; all APIs and delivery sockets are isolated fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/private/tmp/bhidne-join-regression/browser-tools/node_modules/playwright');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
assert.ok(['localhost','127.0.0.1'].includes(new URL(site).hostname));
const initial=JSON.parse(fs.readFileSync(process.env.VIEW_FIXTURE||'/private/tmp/bhidne-stats-fixtures/callbreak-4.json'));
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,390,1280])for(const release of ['leave','automatic','return']){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);
   const snapshot=structuredClone(initial),user={user_id:snapshot.players[0].user_id,token:'reserved-fixture'};
   const room={room_id:snapshot.room_id,name:'Hamro family',creator_id:user.user_id,visibility:'private',members:snapshot.players.map(p=>p.user_id),connected_members:[]};
   snapshot.table_id=snapshot.table.table_id;snapshot.table_revision=6;snapshot.durable_game_id=snapshot.match_id;
   snapshot.status='finished';snapshot.table.phase='COMPLETED';snapshot.table.current_user.is_seated=true;snapshot.table.current_user.can_leave_seat=true;
   const table={...snapshot.tables[0],status:'finished',phase:'COMPLETED',name:'Table-1',game_type:'callbreak',current_user:{...snapshot.table.current_user}};
   snapshot.tables=[table];
   let released=false,failReads=false;const writes=[],errors=[];
   await context.addInitScript(({site,user})=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user}));},{site,user});
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),p=url.pathname;
    if(url.origin!==site)return route.abort();
    if(p==='/'||p.startsWith('/_expo/')||p.startsWith('/assets/')||p==='/favicon.ico')return route.continue();
    if(failReads&&p===`/distributed/ui/rooms/${room.room_id}/game`)return route.fulfill({status:503,json:{detail:'Fixture read unavailable'}});
    let body=[];
    if(p==='/distributed/streams/recipient')body={lane_id:'personal',target:{kind:'recipient',recipient_id:user.user_id.slice(5)}};
    else if(p==='/distributed/streams/social')body={items:[],next_lane_id:null};
    else if(p==='/distributed/streams/open'){const target=request.postDataJSON();body={lane_id:target.kind,target};}
    else if(p.includes('/history/'))body={items:[],next_sequence:null};
    else if(p.includes('/legacy/'))body={items:[],next_cursor:null};
    else if(p==='/distributed/ui/rooms')body={items:[room],next_room_id:null};
    else if(p==='/distributed/ui/memberships')body={items:[{room_id:room.room_id,tables:released?[]:[table],active_game:null}],next_room_id:null};
    else if(p==='/distributed/ui/active-tables')body={items:released?[]:[{...table,room_id:room.room_id,room_name:room.name}],next_room_id:null};
    else if(p.endsWith('/members'))body={items:snapshot.players,next_user_id:null};
    else if(p==='/distributed/room-invitations')body={items:[],next_id:null};
    else if(p==='/distributed/table-invitations')body={items:[],next_table_id:null};
    else if(p==='/distributed/friends')body={friends:[],incoming:[],outgoing:[]};
    else if(p===`/distributed/ui/rooms/${room.room_id}/game`)body={...snapshot,status:released?'ended':'finished',table:{...snapshot.table,current_user:{...snapshot.table.current_user,is_seated:!released}},tables:released?[]:[table]};
    else if(p===`/distributed/rooms/${room.room_id}`)body={room_id:room.room_id,snapshot,tables:released?[]:[table]};
    else if(p===`/distributed/ui/rooms/${room.room_id}`)body={...room,is_member:true,tables:released?[]:[table],active_game:null};
    else if(p==='/auth/me'||p==='/me/profile')body={...user,username:'ekraj',display_name:'ekraj'};
    else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',rules:[]};
    else if(p==='/auth/deletion/capabilities')body={enabled:false};
    else if(p==='/distributed/commands'){
     const envelope=request.postDataJSON(),command=envelope.body;writes.push(command);
     const rejected=command.command==='create-table';
     if(command.command==='leave-seat')released=true;
     body={lane_id:'fixture-command',sequence:writes.length,command_id:command.command_id,status:rejected?'rejected':'accepted',status_reference:{lane_id:'fixture-command',command_id:command.command_id},outcome:{command_id:command.command_id,status:rejected?'rejected':'accepted',...(rejected?{detail:'Leave your existing seat before creating another table.',context:{code:'PLAYER_ALREADY_AT_TABLE',room_id:room.room_id,match_id:snapshot.match_id,requires_leave_game:true,departure_command:'leave'}}:{})}};
    }
    await route.fulfill({json:body});
   });
   await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>ws.onMessage(raw=>{const m=JSON.parse(raw);if(m.type==='AUTH')ws.send(JSON.stringify({type:'READY'}));if(m.type==='PING')ws.send(JSON.stringify({type:'PONG'}));if(m.type==='SUBSCRIBE')ws.send(JSON.stringify({type:'SUBSCRIBED',subscription_id:m.subscription_id,lane_id:m.lane_id,cursor:0}));if(m.type==='ACK')ws.send(JSON.stringify({type:'ACKED',subscription_id:m.subscription_id,scanned_sequence:m.scanned_sequence,cursor:m.scanned_sequence}));}));
   await page.goto(site);
   await page.getByTestId(`play-table-${snapshot.match_id}`).waitFor();
   assert.ok(await page.getByText('Completed · Seat reserved',{exact:true}).isVisible());
   await page.getByRole('button',{name:'Leave Table · Table-1',exact:true}).waitFor().catch(async e=>{console.error(await page.locator('body').innerText(),errors);throw e;});
   await page.getByTestId('play-create-table').click();
   await page.getByRole('button',{name:'Create game',exact:true}).last().click();
   const notice=page.getByTestId('seat-reservation-notice');await notice.waitFor();
   await notice.getByText('Hamro family → Table-1',{exact:true}).waitFor();
   assert.equal(await page.getByText('You already have a seat at another table. Leave it before creating a new table.',{exact:true}).count(),1);
   assert.equal(writes.filter(w=>w.command==='create-table').length,1);
   if(width===390&&release==='leave'){fs.mkdirSync('/private/tmp/bhidne-seat-preview',{recursive:true});await page.screenshot({path:'/private/tmp/bhidne-seat-preview/conflict-390.png',fullPage:true});}
   if(release==='leave'){
    await notice.getByRole('button',{name:'Leave Table',exact:true}).click();
    await notice.waitFor({state:'hidden'}).catch(async e=>{console.error(await page.locator('body').innerText(),writes,errors);throw e;});
    assert.equal(writes.filter(w=>w.command==='leave-seat').length,1);
    assert.equal(writes.find(w=>w.command==='leave-seat').match_id,snapshot.match_id);
   }else if(release==='automatic'){
    released=true;
    if(width===390){failReads=true;await page.waitForTimeout(6000);assert.ok(await notice.isVisible(),'Failed reads must not falsely clear the reservation error');failReads=false;}
    await notice.waitFor({state:'hidden',timeout:10000});
    assert.equal(writes.filter(w=>w.command==='leave-seat').length,0);
   }else{
    await notice.getByRole('button',{name:'Return to table',exact:true}).click();
    await page.getByTestId('room-hero').waitFor();
    await page.getByTestId('live-game-overlay').waitFor();
    assert.equal(writes.filter(w=>w.command==='leave-seat').length,0);
   }
   if(release!=='return')await page.getByTestId(`play-table-${snapshot.match_id}`).waitFor({state:'hidden',timeout:5000});
   assert.deepEqual(errors,[]);
   await context.close();console.log(`PASS ${width}px ${release}: reserved table and single actionable conflict`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
