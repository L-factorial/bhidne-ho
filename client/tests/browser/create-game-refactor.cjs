const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8117';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(12000);
  const rooms=Array.from({length:7},(_,i)=>({room_id:'r'+i,name:'Room '+i,creator_id:'u0',members:['u0'],is_member:true}));const errors=[],writes=[];
  await context.addInitScript(site=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'}}));},site);
  page.on('pageerror',e=>errors.push(e.message));
  await context.route(site+'/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   if(p==='/'||p.startsWith('/_expo/')||p.startsWith('/assets/')||p==='/favicon.ico')return route.continue();
   let body=[];
   if(p==='/auth/me'||p==='/me/profile')body={user_id:'u0',display_name:'Owner',username:'owner'};
   else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',muted_until:null};
   else if(p==='/friends')body={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
   else if(p==='/rooms')body=rooms;
   else if(/^\/rooms\/r\d+(\/enter)?$/.test(p))body=rooms.find(r=>p.split('/')[2]===r.room_id);
   else if(/^\/test-games\/r\d+(\/.*)?$/.test(p)){if(req.method()==='POST'){writes.push(req.postDataJSON());return route.fulfill({status:409,json:{detail:'Fixture creation stops before game entry.'}});}body={status:'empty',tables:[]};}
   await route.fulfill({json:body});
  });
  await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>ws.send(JSON.stringify({type:'CONNECTED'})));
  await page.goto(site);
  await page.getByRole('button',{name:'Create game',exact:true}).first().click();
  const sheet=page.getByTestId('create-game-table');await sheet.waitFor();
  assert.equal(await sheet.getByLabel('Table name',{exact:true}).count(),0);
  await sheet.getByRole('button',{name:'Choose card theme',exact:true}).scrollIntoViewIfNeeded();
  const themeBefore=await sheet.boundingBox();
  await sheet.getByRole('button',{name:'Choose card theme',exact:true}).click();
  const themes=sheet.getByTestId('card-theme-dropdown');await themes.waitFor();
  assert.deepEqual(await sheet.boundingBox(),themeBefore,'card theme dropdown must not resize creation overlay');
  await themes.getByRole('radio',{name:'Kathmandu Durbar Square',exact:true}).click();
  await themes.waitFor({state:'hidden'});
  await sheet.getByRole('button',{name:'Select room',exact:true}).scrollIntoViewIfNeeded();const before=await sheet.boundingBox();
  await sheet.getByRole('button',{name:'Select room',exact:true}).click();
  const dropdown=page.getByTestId('create-room-dropdown');await dropdown.waitFor();assert.deepEqual(await sheet.boundingBox(),before,'dropdown must not resize creation overlay');
  const box=await dropdown.boundingBox();assert.ok(box.height<=146&&box.height>=140);
  await dropdown.evaluate(n=>{const child=[...n.querySelectorAll('*')].find(x=>x.scrollHeight>x.clientHeight+2&&getComputedStyle(x).overflowY==='auto');if(!child)throw new Error('no internal dropdown scroller');child.scrollTop=child.scrollHeight;});
  await dropdown.getByRole('button',{name:'Room 6',exact:true}).click();await dropdown.waitFor({state:'hidden'});
  await sheet.getByRole('button',{name:'Create game',exact:true}).click();await sheet.getByRole('alert').waitFor();
  assert.equal(writes.length,1);assert.equal(writes[0].name,undefined);assert.deepEqual(errors,[]);
  await page.screenshot({path:`/private/tmp/create-game-refactor-${width}.png`});await context.close();console.log(`PASS Create game ${width}: no name field, three-row room overlay, internal scroll, automatic-name request`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
