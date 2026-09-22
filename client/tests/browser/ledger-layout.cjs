const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path,user,body) {
 const r=await fetch(site+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const user=await api('/auth/signup',null,{username:`ledger_${Date.now()}`,display_name:'Prajwal',password:'Ledger-view-123'});
  const room=await api('/rooms',user,{name:'Friday cards'});
  const path=`/rooms/${room.room_id}/ledger`;
  assert.deepEqual((await api(path,user)).player_profiles,{});
  const transfers=[{transfer_id:'pay',batch_id:'batch',table_id:'table-1',payer_id:user.user_id,payee_id:'sita',amount:75,status:'OPEN'},
   {transfer_id:'receive',batch_id:'batch',table_id:'table-1',payer_id:'amit',payee_id:user.user_id,amount:30,status:'MARKED_PAID'}];
  const balances=[{player_id:user.user_id,amount:-45},{player_id:'sita',amount:75},{player_id:'amit',amount:-30}];
  const data={room_name:room.name,players:{[user.user_id]:'Prajwal',sita:'Sita Rai',amit:'Amit'},
   player_profiles:{[user.user_id]:{display_name:'Prajwal'},sita:{display_name:'Sita Rai',avatar_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='},amit:{display_name:'Amit',avatar_url:site+'/missing-avatar.png'}},
   balances,tables:[{table_id:'table-1',table_name:'Evening Marriage',game_count:1,balances,games:[{game_id:'game-1',game_type:'marriage',settled:false}],transactions:[],suggested_transfers:[transfers[0]]}],personal_settlements:transfers};
  const page=await browser.newPage({viewport:{width:390,height:844}}), errors=[],actions=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({site,user,room})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user,room,game:null})),{site,user,room});
  await page.route(site+path+'**',route=>{
   const req=route.request();
   if(req.method()==='POST') { actions.push({url:req.url(),body:req.postDataJSON()}); if(req.url().endsWith('/mark-paid'))transfers[0].status='MARKED_PAID';if(req.url().endsWith('/confirm'))transfers[1].status='RESOLVED';return route.fulfill({json:{}}); }
   return route.fulfill({json:data});
  });
  await page.goto(site);await page.getByRole('button',{name:'Room ledger',exact:true}).click();
  const sheet=page.getByTestId('room-sheet');await sheet.getByTestId('ledger-balances').waitFor();
  await sheet.getByLabel('Anonymous player profile').nth(1).waitFor();
  assert.equal(await sheet.getByLabel('Player photo').count(),1);
  await sheet.getByRole('button').filter({hasText:'Evening Marriage'}).click();
  await sheet.getByTestId('ledger-transfer').getByText('From',{exact:true}).waitFor();
  await sheet.getByRole('button',{name:'Start table settlement',exact:true}).click();
  assert.equal(actions.at(-1).body.scope,'table');assert.equal(actions.at(-1).body.table_id,'table-1');
  await sheet.getByRole('tab',{name:'My settlements',exact:true}).click();
  for(const width of [320,390,1280]) {
   await page.setViewportSize({width,height:900});
   await page.waitForTimeout(100);
   for(const row of await sheet.getByTestId('ledger-transfer').all()) {const b=await row.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1);}
   await page.screenshot({path:`/tmp/ledger-settlements-${width}.png`,fullPage:true});
  }
  await sheet.getByRole('button',{name:'Mark paid',exact:true}).click();
  await sheet.getByRole('button',{name:'Mark paid',exact:true}).waitFor({state:'hidden'});
  assert.ok(actions.at(-1).url.endsWith('/batch/transfers/pay/mark-paid'));
  await sheet.getByRole('button',{name:'Confirm received',exact:true}).click();
  await sheet.getByRole('button',{name:'Confirm received',exact:true}).waitFor({state:'hidden'});
  assert.ok(actions.at(-1).url.endsWith('/batch/transfers/receive/confirm'));
  assert.deepEqual(errors,[]);
  console.log('PASS ledger: photos/fallback, columns/arrows, context names/codes, responsive layout, settlement creation/payment/confirmation');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
