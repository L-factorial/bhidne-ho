const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const names=['Asha','Bina','Chandra','Deepak'], pages=[], errors=[];
  const room={room_id:'names-check',name:'Names check',members:names.map((_,i)=>`u${i}`)};
  for(let i=0;i<4;i++){
   const context=await browser.newContext({viewport:{width:360,height:800}});
   await context.addInitScript(i=>sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',JSON.stringify({session:{user_id:`u${i}`,token:`token${i}`},room:null,game:null})),i);
   await context.route('http://localhost:8000/**',async route=>{
    const path=new URL(route.request().url()).pathname;let body=[];
    if(path==='/me/profile'){
     if(route.request().method()==='PATCH')names[i]=route.request().postDataJSON().display_name;
     body={display_name:names[i]};
    }else if(path==='/rooms')body=[room];
    else if(path.startsWith('/test-games/'))body={room_id:room.room_id,match_id:'m1',capacity:4,players:room.members.map((user_id,j)=>({user_id,player_id:j+1,display_name:names[j]})),your_player_id:i+1,is_creator:i===0,ready:true,status:'playing',game:{revision:1,phase:'AWAITING_SHUFFLE',finished:false,winners:[],turn:{player_id:1},current_trick:null,scores_tenths:[0,0,0,0]},deal:{deal_number:1,dealer:1,tricks_completed:0,tricks_required:13,tricks:[],players:names.map((_,j)=>({player_id:j+1,bid:null,tricks_won:0,cards_remaining:0}))},private:{hand:[],legal_cards:[],can_accept_hand:false,can_claim_redeal:false}};
    await route.fulfill({json:body});
   });
   await context.routeWebSocket('ws://localhost:8000/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));pages.push(page);await page.goto('http://localhost:8081');
   const tools=page.getByRole('button',{name:'Create room / Join with code',exact:true});const rooms=page.getByRole('button',{name:'Available rooms',exact:true});await tools.waitFor();
   assert.equal(await tools.getAttribute('aria-expanded'),'false');assert.equal(await rooms.getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('textbox',{name:'Room name',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Enter Names check',exact:true}).count(),0);
   await tools.click();await page.getByRole('textbox',{name:'Room name',exact:true}).waitFor();await page.getByRole('button',{name:'Join with code',exact:true}).click();await page.getByRole('textbox',{name:'Table code / room ID',exact:true}).waitFor();await tools.click();assert.equal(await tools.getAttribute('aria-expanded'),'false');
   await page.getByRole('button',{name:'Open profile',exact:true}).click();await page.getByRole('textbox',{name:'Game display name',exact:true}).waitFor();await page.waitForFunction(expected=>document.querySelector('[aria-label="Game display name"]')?.value===expected,names[i]);await page.getByRole('button',{name:'Back from profile',exact:true}).click();
  }
  await pages[0].getByRole('button',{name:'Open profile',exact:true}).click();
  const input=pages[0].getByRole('textbox',{name:'Game display name',exact:true});await input.fill('Asha Ace');await pages[0].getByRole('button',{name:'Save display name',exact:true}).click();await pages[0].getByText('Display name saved.',{exact:true}).waitFor();await pages[0].getByRole('button',{name:'Back from profile',exact:true}).click();

  for(let i=0;i<4;i++){
   await pages[i].getByRole('button',{name:'Available rooms',exact:true}).click();
   await pages[i].getByRole('button',{name:'Enter Names check',exact:true}).click();await pages[i].getByTestId('card-table').waitFor();
   for(let j=0;j<4;j++)await pages[i].getByTestId('card-table').getByText(j===i?`${names[j]} · You`:names[j],{exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);console.log('PASS: collapsed room sections, profile name isolation, and saved names on every visible seat.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
