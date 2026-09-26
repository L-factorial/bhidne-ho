// Run after EXPO_PUBLIC_RUNTIME_MODE=distributed-integration npm run build:web.
// PLAYWRIGHT_MODULE points to a separately installed Playwright package.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const dist=path.resolve(__dirname,'../dist');
 const fixtures=process.env.DISTRIBUTED_SNAPSHOT_DIR?['callbreak','marriage','flush'].map(kind=>JSON.parse(fs.readFileSync(path.join(process.env.DISTRIBUTED_SNAPSHOT_DIR,kind+'.json'),'utf8'))):[];
 const server=http.createServer((req,res)=>{
  const filename=path.join(dist,decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!filename.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  const file=fs.existsSync(filename)&&fs.statSync(filename).isFile()?filename:path.join(dist,'index.html');
  const types={'.html':'text/html','.js':'application/javascript','.ttf':'font/ttf','.png':'image/png'};
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();const errors=[],writes=[];let created=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   const json=data=>route.fulfill({json:data});
   if(p==='/me/phrases')return json([]);
   if(p==='/me/profile')return json({user_id:'user-00000000-0000-0000-0000-000000000001',display_name:'Alice'});
   if(p==='/friends'&&req.method()==='GET')return json({friends:[],incoming:[],outgoing:[]});
   if(p==='/auth/signin')return json({user_id:'user-00000000-0000-0000-0000-000000000001',token:'test-token'});
   if(p.startsWith('/distributed/')){
    if(req.method()==='POST'&&p==='/distributed/rooms'){
     const body=req.postDataJSON();writes.push(body);created=true;
     return json({command_id:body.command_id,status:'accepted',room_id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});
    }
    if(p==='/distributed/rooms')return json({items:created?[{room_id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',name:'Test room',is_member:true,open_table_count:0}]:[],next_room_id:null});
    if(p==='/distributed/room-invitations')return json({items:[],next_id:null});
    if(p==='/distributed/table-invitations')return json({items:[],next_table_id:null});
    if(p.endsWith('/ledger'))return json({players:{},balances:[],tables:[],personal_settlements:[]});
    if(p==='/distributed/streams/recipient')return json({lane_id:'recipient',target:{kind:'recipient',recipient_id:'00000000-0000-0000-0000-000000000001'}});
    if(p==='/distributed/streams/social')return json({items:[],next_lane_id:null});
    if(p==='/distributed/streams/open'){const target=req.postDataJSON();return json({lane_id:target.kind,target});}
    if(p.startsWith('/distributed/history/'))return json({items:[],next_sequence:null});
    if(p.endsWith('/members'))return json({items:[],next_user_id:null});
    if(p==='/distributed/rooms/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')return json({room_id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',name:'Test room',tables:fixtures.map(v=>({table_id:v.table_id,name:'Fixture '+v.game_type,game_type:v.game_type})),snapshot:fixtures.find(v=>v.table_id===url.searchParams.get('table_id'))||null});
    throw Error('Unexpected distributed request '+p);
   }
   if(p.startsWith('/auth/')||p.startsWith('/rooms')||p.startsWith('/test-games')||p.startsWith('/ws/'))throw Error('Unexpected legacy request '+p);
   return route.continue();
  });
  await page.routeWebSocket('**/distributed/delivery',ws=>ws.onMessage(raw=>{
   const msg=JSON.parse(raw);
   if(msg.type==='AUTH')ws.send(JSON.stringify({type:'READY'}));
   if(msg.type==='SUBSCRIBE')ws.send(JSON.stringify({type:'SUBSCRIBED',subscription_id:msg.subscription_id,lane_id:msg.lane_id,cursor:0}));
   if(msg.type==='PING')ws.send(JSON.stringify({type:'PONG'}));
  }));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('textbox',{name:'Username',exact:true}).fill('alice');
  await page.getByLabel('Password',{exact:true}).fill('test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('textbox',{name:'Room name',exact:true}).fill('Test room');
  await page.getByRole('button',{name:'Create room',exact:true}).click();
  await page.getByRole('button',{name:'Test room',exact:true}).waitFor({timeout:10000}).catch(async e=>{console.error({text:await page.locator('body').innerText(),errors,writes});throw e;});
  assert.equal(writes.length,1);assert.ok(writes[0].command_id);
  const journal=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('distributed-commands:')));
  assert.equal(journal.length,1);assert.ok(journal[0][1].includes(writes[0].command_id));assert.ok(!journal[0][1].includes('test-token'));
  await page.reload();
  await page.getByRole('button',{name:'Test room',exact:true}).click();
  await page.getByRole('textbox',{name:'Table name',exact:true}).waitFor();
  assert.equal(writes.length,1);
  await page.getByRole('button',{name:'Profile and friends',exact:true}).click();
  await page.getByText('Notifications',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close profile and friends',exact:true}).click();
  await page.getByRole('button',{name:'Ledger',exact:true}).click();
  await page.getByTestId('ledger-section-toggle').waitFor();
  await page.getByRole('button',{name:'Close ledger',exact:true}).click();
  for(const view of fixtures){
   await page.getByRole('button',{name:'Fixture '+view.game_type+' · '+view.game_type,exact:true}).click();
   await page.getByRole('button',{name:'Chat',exact:true}).waitFor();
   await page.screenshot({path:path.join(process.env.DISTRIBUTED_SNAPSHOT_DIR,view.game_type+'.png'),fullPage:true});
   assert.deepEqual(errors,[]);
   await page.reload();await page.getByRole('button',{name:'Test room',exact:true}).click();
   await page.getByRole('textbox',{name:'Table name',exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);
  console.log(`Mounted integration smoke passed: login, durable room creation, disk journal, reload, room selection and ${fixtures.length} game projections; no legacy room traffic.`);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
