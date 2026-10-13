// Local exported app; all account/room/ledger responses are isolated fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:900}});
   const page=await context.newPage();page.setDefaultTimeout(12000);
   const rooms=['r1','r2'].map((room_id,index)=>({room_id,name:index?'Weekend cards':'Friday cards',creator_id:'u0',members:['u0','u1'],connected_members:['u0'],is_member:true}));
   const balances=[{player_id:'u0',amount:20},{player_id:'u1',amount:-20}];
   const ledger={room_name:'Friday cards',players:{u0:'Ekraj',u1:'Friend'},balances,personal_settlements:[{batch_id:'b',table_id:'t1',transfer_id:'x',payer_id:'u0',payee_id:'u1',amount:10,status:'OPEN'}],tables:[
    {table_id:'t1',table_name:'Table-1',game_type:'flush',latest_game_at:'2026-10-12T12:00:00Z',game_count:1,balances,games:[{game_id:'g1',game_type:'flush',settled:false,balances}],suggested_transfers:[],transactions:[]},
    {table_id:'t2',table_name:'Table-2',game_type:'marriage',latest_game_at:'2026-10-13T12:00:00Z',game_count:2,balances,games:[],suggested_transfers:[],transactions:[]}]};
   let pending=true, ledgerFail=false, paged=0;
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(site=>{
    localStorage.setItem('bhidne.language','en');
    sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'},room:null,game:null}));
   },site);
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    if(url.origin!==site)return route.abort();
    if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
    let body=[];
    if(p==='/ledger/rooms'){
     if(ledgerFail)return route.fulfill({status:503,json:{detail:'Ledger temporarily unavailable.'}});
     const after=url.searchParams.get('after_room_id');if(after)paged++;
     body={items:pending?[{room_id:after?'r2':'r1',name:after?'Weekend cards':'Friday cards',latest_game_at:'2026-10-12T12:00:00Z'}]:[],next_room_id:pending&&!after?'r1':null};
    }else if(p==='/rooms')body=rooms;
    else if(/^\/rooms\/r[12](\/enter)?$/.test(p))body=rooms.find(r=>p.includes(r.room_id));
    else if(p==='/rooms/r1/ledger')body=ledger;
    else if(p.startsWith('/test-games/r'))body={room_id:'r1',status:'empty',tables:[]};
    else if(p==='/auth/me')body={user_id:'u0',username:'ekraj',display_name:'Ekraj'};
    else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',muted_until:null};
    else if(p==='/friends')body={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
    else if(p==='/auth/safety/capabilities')body={blocking:false,reporting:false};
    await route.fulfill({json:body});
   });
   await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(raw=>{if(JSON.parse(raw).type==='HEARTBEAT')ws.send(JSON.stringify({type:'HEARTBEAT_ACK'}));});});
   await page.goto(site);
   const nav=page.getByTestId('lobby-navigation');await nav.waitFor();
   await nav.getByRole('tab',{name:'Ledger',exact:true}).waitFor();
   assert.deepEqual(await nav.getByRole('tab').evaluateAll(tabs=>tabs.map(tab=>tab.getAttribute('aria-label'))),['Home','Ledger','Friends','Chat']);
   await nav.getByRole('tab',{name:'Ledger',exact:true}).click();
   await page.getByTestId('pending-ledger-room-r2').waitFor();assert.ok(paged>0);if(width===390)await page.screenshot({path:'/private/tmp/bhidne-lobby-ledger-390.png'});
   assert.equal(await page.getByRole('tab',{name:'Play',exact:true}).count(),0);
   await page.getByTestId('pending-ledger-room-r1').click();
   const sheet=page.getByTestId('room-sheet');await sheet.waitFor();
   assert.deepEqual(await sheet.getByRole('tab').allTextContents(),['Balances','Table Balances','My settlement']);
   await sheet.getByTestId('ledger-balances').waitFor();
   assert.equal(await sheet.getByTestId('ledger-table-card-t1').count(),0);
   assert.equal(await sheet.getByRole('tab',{name:'Balances',exact:true}).getAttribute('aria-selected'),'true');
   await sheet.getByRole('tab',{name:'Table Balances',exact:true}).click();
   const table=sheet.getByTestId('ledger-table-card-t1');await table.waitFor();
   await table.getByText('Flush-Table-1',{exact:true}).waitFor();
   await table.getByText('1 game · Oct 12, 2026',{exact:true}).waitFor();
   await sheet.getByText('2 games · Oct 13, 2026',{exact:true}).waitFor();
   assert.equal(await sheet.getByTestId('ledger-balances').count(),0);
   const date=table.getByText('1 game · Oct 12, 2026',{exact:true});
   assert.equal(await date.evaluate(el=>getComputedStyle(el).textAlign),'center');
   if(width===390)await page.screenshot({path:'/private/tmp/bhidne-table-balances-390.png'});
   await table.getByRole('button').click();await table.getByTestId('ledger-balances').first().waitFor();
   await sheet.getByRole('tab',{name:'My settlement',exact:true}).click();
   await sheet.getByRole('button',{name:'Mark paid',exact:true}).waitFor();
   assert.equal(await sheet.getByTestId('ledger-table-card-t1').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`/private/tmp/bhidne-ledger-${width}.png`});
   await page.getByTestId('room-sheet-close').click();
   pending=false;
   await page.getByRole('button',{name:'Back to lobby',exact:true}).click();
   await page.getByText('No rooms with pending balances.',{exact:true}).waitFor();
   assert.equal(await nav.getByRole('tab',{name:'Ledger',exact:true}).getAttribute('aria-selected'),'true');
   ledgerFail=true;await page.reload();await nav.getByRole('tab',{name:'Ledger',exact:true}).click();
   await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
   ledgerFail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
   await page.getByText('No rooms with pending balances.',{exact:true}).waitFor();
   assert.deepEqual(errors,[]);
   await context.close();console.log(`PASS ${width}px: pagination, direct room ledger, three tabs, dates, settlement controls, empty state and retry`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
