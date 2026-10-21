// Local API fixtures only; no live rooms or games are created.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8117';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(12000);
  const rooms=Array.from({length:7},(_,i)=>({room_id:'r'+i,name:'Room '+i,creator_id:'u0',members:['u0'],is_member:true}));const errors=[],writes=[];
  await context.addInitScript(site=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'},room:null,game:null}));},site);
  page.on('pageerror',e=>errors.push(e.message));
  await context.route(site+'/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   if(p==='/'||p.startsWith('/_expo/')||p.startsWith('/assets/')||p==='/favicon.ico')return route.continue();
   let body=[];
   if(p==='/auth/me'||p==='/me/profile')body={user_id:'u0',display_name:'Owner',username:'owner'};
   else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',muted_until:null};
   else if(p==='/friends')body={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
   else if(p.startsWith('/players/'))body=[{user_id:'user-prayash',display_name:'Prayash2496',username:'prayash2496'}];
   else if(p==='/rooms'){if(req.method()==='POST'){writes.push(req.postDataJSON());body={...rooms[0],room_id:'r8',name:req.postDataJSON().name};}else body=rooms;}
   else if(/^\/rooms\/r\d+(\/enter)?$/.test(p))body=rooms.find(r=>p.split('/')[2]===r.room_id)||{...rooms[0],room_id:'r8',name:'Room 0 2'};
   else if(/^\/test-games\/r\d+(\/.*)?$/.test(p)){if(req.method()==='POST'){writes.push(req.postDataJSON());return route.fulfill({status:409,json:{detail:'Fixture creation stops before game entry.'}});}body={status:'empty',tables:[]};}
   await route.fulfill({json:body});
  });
  await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>ws.send(JSON.stringify({type:'CONNECTED'})));
  await page.goto(site);
  await page.getByRole('button',{name:'Create game',exact:true}).first().click();
  const sheet=page.getByTestId('create-game-table');await sheet.waitFor();
  await sheet.getByRole('button',{name:'Select room',exact:true}).scrollIntoViewIfNeeded();const before=await sheet.boundingBox();
  await sheet.getByRole('button',{name:'Select room',exact:true}).click();
  const dropdown=page.getByTestId('create-room-dropdown');await dropdown.waitFor();assert.deepEqual(await sheet.boundingBox(),before,'dropdown must not resize creation overlay');

  const options=page.getByTestId('create-room-options');
  assert.equal(Math.round((await options.boundingBox()).height),144,'show at most three 48px rows');
  const action=dropdown.getByRole('button',{name:'Create in a new room',exact:true});
  const pinned=await action.boundingBox();
  await options.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  assert.deepEqual(await action.boundingBox(),pinned,'create action stays pinned while options scroll');
  assert.ok(pinned.y+pinned.height<=1000);
  await page.screenshot({path:`/private/tmp/new-room-option-${width}.png`});
  const box=await dropdown.boundingBox();
  await dropdown.getByRole('button',{name:'Create in a new room',exact:true}).click();
  const field=dropdown.getByRole('textbox',{name:'New room name',exact:true});
  assert.equal(await sheet.getByRole('button',{name:'Create game',exact:true}).isDisabled(),true);
  await field.fill('A very long room name that must stay inside the fixed dropdown width while typing');
  const after=await dropdown.boundingBox();assert.ok(Math.abs(after.width-box.width)<1);
  assert.ok(Math.abs((await sheet.boundingBox()).width-before.width)<1);
  if(width<900){
   await page.setViewportSize({width,height:480});
   await field.fill('Keyboard visible');
   await page.waitForFunction(()=>{const input=document.querySelector('input[aria-label="New room name"]');if(!input)return false;const b=input.getBoundingClientRect();return b.top>=0&&b.bottom<=window.innerHeight;});
   const inputBounds=await field.boundingBox();
   assert.ok(inputBounds.y>=0&&inputBounds.y+inputBounds.height<=480,'name stays above reduced keyboard viewport');
   await page.screenshot({path:`/private/tmp/new-room-keyboard-${width}.png`});
   await page.setViewportSize({width,height:1000});
  }
  await field.fill('Room 0');
  await page.screenshot({path:`/private/tmp/new-room-input-${width}.png`});
  await dropdown.getByRole('button',{name:'Confirm new room',exact:true}).click();
  await dropdown.waitFor({state:'hidden'});
  await sheet.getByRole('button',{name:'Select room',exact:true}).getByText('Room 0 2',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`/private/tmp/new-room-confirmed-${width}.png`});
  await sheet.getByRole('button',{name:'Create game',exact:true}).click();await sheet.getByRole('alert').waitFor();
  assert.equal(writes[0].name,'Room 0 2');assert.equal(writes.length,2);
  await context.close();console.log(`PASS ${width}px inline name, duplicate suffix, fixed width`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
