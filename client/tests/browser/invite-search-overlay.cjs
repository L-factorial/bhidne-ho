// Local API fixtures only: no real invitations or tables are created.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8129';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(15000);
  const room={room_id:'room',name:'Invite room',creator_id:'u0',members:['u0']};
  const players=['Ekraj','Bhojraj','Hadraj','Sigma','A player with a very long display name','Gorkhe','Hari','Ram'].map((display_name,i)=>({user_id:'p'+i,username:'player'+i,display_name}));
  await context.addInitScript(site=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'},room:null,game:null}));},site);
  page.on('pageerror',e=>errors.push(e.message));
  await context.route(site+'/**',async route=>{
   const p=new URL(route.request().url()).pathname,q=new URL(route.request().url()).searchParams.get('q');
   if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
   let body=[];
   if(p==='/auth/me'||p==='/me/profile')body={user_id:'u0',username:'self',display_name:'Self'};
   else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01'};
   else if(p==='/friends')body={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
   else if(p==='/rooms')body=[room];
   else if(p.startsWith('/players/'))body=q==='ekraj'?[players[0]]:players;
   await route.fulfill({json:body});
  });
  await page.goto(site);await page.getByRole('button',{name:'Create game',exact:true}).first().click();
  const sheet=page.getByTestId('create-game-table'),input=sheet.getByRole('textbox',{name:'Find player to invite',exact:true});
  await input.fill('ekraj');const results=page.getByTestId('invite-player-suggestions');await results.getByRole('button').waitFor();
  const before=await sheet.boundingBox();await input.fill('player');await results.getByRole('button',{name:'Invite Ram',exact:true}).waitFor();
  const after=await sheet.boundingBox();assert.ok(Math.abs(before.height-after.height)<2,'results do not stretch the creation sheet');
  assert.equal(await results.evaluate(n=>getComputedStyle(n).position),'absolute');assert.ok((await results.boundingBox()).height<=180);
  for(const name of ['Ekraj','Bhojraj','Hadraj','Sigma','A player with a very long display name']){
   await input.fill('player');await results.getByRole('button',{name:'Invite '+name,exact:true}).click();await results.waitFor({state:'hidden'});
  }
  const chips=page.getByTestId('invite-player-chips');const bounds=await chips.boundingBox();
  const boxes=await chips.evaluate(n=>[...n.children].map(c=>{const r=c.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
  assert.equal(boxes.length,5);assert.ok(boxes.every(b=>b.x>=bounds.x-1&&b.x+b.width<=bounds.x+bounds.width+1));
  assert.ok(boxes[0].width<bounds.width*0.8,'names do not fill empty row width');
  assert.ok(boxes.some((b,i)=>i&&Math.abs(b.y-boxes[i-1].y)<1),'short names share a row');
  if(width<900)assert.ok(boxes.some(b=>b.y>boxes[0].y+10),'chips wrap at narrow widths');
  await chips.getByRole('button',{name:'Remove Bhojraj',exact:true}).click();assert.equal(await chips.getByRole('button').count(),4);
  await page.screenshot({path:`/private/tmp/invite-chips-${width}.png`});assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS invite overlay and wrapping chips ${width}px`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
