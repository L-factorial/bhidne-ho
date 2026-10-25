// Controlled response delays measure rendering, independent of production/network variance.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108',baseline=process.env.BASELINE==='1';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);
 const reads={},starts=[],errors=[],writes=[];let slow=false,ledgerVersion=0,chatVersion=0,secondPageComplete=false;
 await context.addInitScript(site=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'}}));},site);
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await context.route(site+'/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname;
 if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
 if(req.method()!=='GET')writes.push(p);
 reads[p]=(reads[p]||0)+1;starts.push({p,time:Date.now()});let body=[];
 if(p==='/auth/me'||p==='/me/profile')body={user_id:'u0',display_name:'Test',username:'tester'};
 else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',muted_until:null};
 else if(p==='/active-tables'){await pause(slow?1500:180);body=[];}
 else if(p==='/friends'){await pause(slow?1500:180);body={friends:[{user_id:'u1',display_name:'Sita'},{user_id:'u2',display_name:'Amit'}],incoming:[],outgoing:[],online_friend_ids:['u1','u2']};}
 else if(p==='/friends/conversations'){await pause(slow?1500:180);body=[{user_id:'u1',id:'m'+chatVersion,sender_id:'u1',text:chatVersion?'Updated conversation':'Cached conversation',sent_at:Date.now()/1000}];}
 else if(p==='/friends/u2/messages'){await pause(800);body=[];}
 else if(p==='/friends/u1/messages'){await pause(slow?1500:800);body=[{id:'m0',sender_id:'u1',recipient_id:'u0',text:'Hello there',sent_at:Date.now()/1000}];}
 else if(p==='/ledger/rooms'){const cursor=url.searchParams.get('after_room_id');await pause(slow?1500:cursor?700:120);body=cursor?{items:[{room_id:'r2',name:'Second room'}],next_room_id:null}:{items:[{room_id:'r1',name:ledgerVersion?'Updated room':'First room'}],next_room_id:'r1'};}
 try{await route.fulfill({json:body});if(p==='/ledger/rooms'&&url.searchParams.get('after_room_id'))secondPageComplete=true;}catch{}
 });
 await page.goto(site);await page.getByTestId('active-games-empty').waitFor();
 const nav=page.getByTestId('lobby-navigation');
 const metrics={};async function show(tab,locator,key){const t=Date.now();await nav.getByRole('tab',{name:tab,exact:true}).click();await locator.waitFor({state:'visible'});metrics[key]=Date.now()-t;}
 await show('Ledger',page.getByTestId('pending-ledger-room-r1'),'ledgerFirstPageMs');
 const progressive=!secondPageComplete;
 await page.getByTestId('pending-ledger-room-r2').waitFor();
 await show('Chat',page.getByTestId('chat-conversations').getByRole('button',{name:'Chat with Sita',exact:true}),'chatFirstContentMs');
 await page.getByTestId('chat-conversations').getByRole('button',{name:'Chat with Sita',exact:true}).click();
 if(!baseline){const history=page.getByTestId('private-chat-history');await history.getByTestId('private-chat-loading').waitFor();await history.getByText('Cached conversation',{exact:true}).waitFor();assert.equal(await history.getByText('No messages yet.',{exact:true}).count(),0);}
 await page.getByText('Hello there',{exact:true}).waitFor();
 const input=page.getByRole('textbox',{name:'Message Sita',exact:true});await input.fill('Keep my draft');
 await page.getByRole('button',{name:'Close private chat',exact:true}).click();
 slow=true;
 await show('Home',page.getByTestId('active-games-empty'),'homeReturnMs');
 await show('Ledger',page.getByTestId('pending-ledger-room-r1'),'ledgerReturnMs');
 await show('Chat',page.getByTestId('chat-conversations').getByRole('button',{name:'Chat with Sita',exact:true}),'chatReturnMs');
 if(!baseline){
  for(const key of ['homeReturnMs','ledgerReturnMs','chatReturnMs'])assert.ok(metrics[key]<1000,`${key} should not wait for delayed network`);
  assert.ok(progressive,'first ledger page should render before second response');
  const friend=starts.filter(x=>x.p==='/friends').at(-1),convo=starts.filter(x=>x.p==='/friends/conversations').at(-1);assert.ok(Math.abs(friend.time-convo.time)<150,'chat requests start together');
  const historyStart=Date.now();await page.getByTestId('chat-conversations').getByRole('button',{name:'Chat with Sita',exact:true}).click();await page.getByText('Hello there',{exact:true}).waitFor();metrics.chatHistoryReturnMs=Date.now()-historyStart;assert.ok(metrics.chatHistoryReturnMs<1000,'cached history must precede delayed history response');assert.equal(await input.inputValue(),'Keep my draft');await page.getByRole('button',{name:'Close private chat',exact:true}).click();
  const before={...reads};await pause(16100);assert.equal(reads['/ledger/rooms'],before['/ledger/rooms'],'hidden ledger must not poll');assert.equal(reads['/active-tables'],before['/active-tables'],'hidden Home must not poll');
  chatVersion=1;await page.getByText('Updated conversation',{exact:true}).waitFor();
  await nav.getByRole('tab',{name:'Home',exact:true}).click();ledgerVersion=1;await nav.getByRole('tab',{name:'Ledger',exact:true}).click();await page.getByRole('button',{name:'Updated room',exact:true}).waitFor();
  await nav.getByRole('tab',{name:'Chat',exact:true}).click();
  await page.getByTestId('chat-people-strip').getByRole('button',{name:'Amit',exact:true}).click();
  const emptyHistory=page.getByTestId('private-chat-history');await emptyHistory.getByTestId('private-chat-loading').waitFor();
  assert.equal(await emptyHistory.getByText('No messages yet.',{exact:true}).count(),0);
  await emptyHistory.getByText('No messages yet.',{exact:true}).waitFor();
  assert.equal(await emptyHistory.getByText('Hello there',{exact:true}).count(),0,'previous recipient history must never leak into another conversation');
  await page.getByRole('button',{name:'Close private chat',exact:true}).click();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 const out=process.env.PERF_OUTPUT||'/private/tmp/bhidne-lobby-performance.json';fs.writeFileSync(out,JSON.stringify({baseline,metrics,reads},null,2));console.log(JSON.stringify({baseline,metrics}));await context.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
