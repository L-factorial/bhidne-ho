// Delayed/rejected local HTTP fixtures only; no real messages.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8139';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const kind of ['direct','room']){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'no-preference'}),page=await context.newPage();page.setDefaultTimeout(12000);
  const room={room_id:'room',name:'Chat room',members:['u0','u1'],connected_members:['u0','u1']};
  await context.addInitScript(({site,room,kind})=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:{user_id:'u0',token:'fixture'},room:kind==='room'?room:null,game:kind==='room'?'callbreak':null}));},{site,room,kind});
  const history=Array.from({length:30},(_,i)=>({id:`old-${i}`,sender_id:'u1',recipient_id:'u0',sender_name:'Alice',text:`Older message ${i}`,sent_at:Date.now()-60000+i}));
  const endpoint=kind==='direct'?'/friends/u1/messages':'/rooms/room/chat';let held=null,requests=0;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route(site+'/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
   let data=[];
   if(p==='/auth/me'||p==='/me/profile')data={user_id:'u0',display_name:'Me',username:'me'};
   else if(p==='/me/community-rules')data={accepted:true,version:'2026-10-01'};
   else if(p==='/friends')data={friends:[{user_id:'u1',display_name:'Alice',username:'alice'}],incoming:[],outgoing:[],online_friend_ids:['u1']};
   else if(p==='/rooms')data=[room];
   else if(p==='/rooms/room'||p==='/rooms/room/enter')data={...room,is_member:true};
   else if(p.startsWith('/test-games/room'))data=JSON.parse(fs.readFileSync('/private/tmp/bhidne-stats-fixtures/callbreak-4.json'));
   else if(p===endpoint){if(route.request().method()==='POST'){held=route;requests++;return;}data=history;}
   await route.fulfill({json:data});
  });
  await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
  await page.goto(site);
  if(kind==='direct'){await page.getByTestId('lobby-navigation').getByRole('tab',{name:'Chat',exact:true}).click();await page.getByTestId('chat-people-strip').getByRole('button',{name:'Alice',exact:true}).click();}
  else await page.getByRole('button',{name:'Room chat',exact:true}).click();
  const list=page.getByTestId(kind==='direct'?'private-chat-history':'room-chat-history');await list.getByText('Older message 29',{exact:true}).waitFor();
  const input=page.getByRole('textbox',{name:kind==='direct'?'Message Alice':'Room chat',exact:true});
  const send=page.getByRole('button',{name:kind==='direct'?'Send privately':'Send chat message',exact:true});
  const waitRequest=async()=>{for(let i=0;i<100&&!held;i++)await page.waitForTimeout(20);assert.ok(held);};
  const confirm=async(text)=>{const saved={id:`sent-${requests}`,sender_id:'u0',recipient_id:'u1',sender_name:'Me',text,sent_at:Date.now()};history.push(saved);const route=held;held=null;await route.fulfill({json:saved});};
  await list.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await input.fill('Instant bubble');await send.click();await waitRequest();
  await list.getByText('Instant bubble',{exact:true}).waitFor();assert.equal(await input.inputValue(),'');
  await page.getByTestId('chat-sending-border').waitFor();assert.equal(await page.getByTestId('activity-line').count(),0,'sending uses the bubble border');
  const border=page.getByTestId('chat-sending-border');
  const firstOpacity=await border.evaluate(el=>getComputedStyle(el).opacity);await page.waitForTimeout(300);
  assert.notEqual(await border.evaluate(el=>getComputedStyle(el).opacity),firstOpacity,'bubble border must fade while sending');
  assert.ok(await list.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<45),'own outgoing message is visible');
  await page.screenshot({path:`/private/tmp/${kind}-chat-sending-border.png`});
  await confirm('Instant bubble');await page.getByTestId('chat-sending-border').waitFor({state:'hidden'});
  await input.fill('Retry bubble');await send.click();await waitRequest();
  const timeBefore=await page.getByTestId('outgoing-chat-message').getByTestId('chat-message-time').boundingBox();
  const failed=held;held=null;await failed.fulfill({status:429,json:{detail:'Try again shortly'}});
  await page.getByTestId('chat-retry').waitFor();
  const bubble=page.getByTestId('outgoing-chat-message');
  const bounds=await bubble.boundingBox(),sender=await bubble.getByTestId('chat-sender').boundingBox(),retry=await bubble.getByTestId('chat-retry').boundingBox();
  assert.ok(Math.abs(sender.y+sender.height/2-(bounds.y+bounds.height/2))<2,'sender is vertically centered');
  const body=await bubble.getByTestId('chat-message-body').boundingBox(),time=await bubble.getByTestId('chat-message-time').boundingBox();
  assert.ok(Math.abs(retry.y+retry.height/2-(body.y+body.height/2))<2,'retry is centered above the timestamp');
  assert.ok(retry.y+retry.height<=time.y,'retry stays above timestamp');
  assert.ok(Math.abs(time.x-timeBefore.x)<1&&Math.abs(time.y-timeBefore.y)<1,'retry does not displace time');
  assert.ok(retry.x>sender.x+sender.width,'retry is on the right');
  assert.ok(!/Sending|Confirming|Not sent/.test(await bubble.innerText()),'no visible sending status text');
  await page.screenshot({path:`/private/tmp/${kind}-chat-retry.png`});
  await page.getByTestId('chat-retry').click();await waitRequest();
  assert.equal(await list.getByText('Retry bubble',{exact:true}).count(),1);
  await confirm('Retry bubble');await page.getByTestId('chat-sending-border').waitFor({state:'hidden'});
  assert.equal(await page.getByTestId('chat-retry').count(),0);assert.equal(requests,3);assert.deepEqual(errors,[]);
  await context.close();console.log(`PASS ${kind}: immediate bubble, cleared input, animated border, scroll visibility, failed retry and no duplicates.`);
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
