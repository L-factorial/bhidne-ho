const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const site=process.env.TEST_WEB_URL || 'http://127.0.0.1:8097';
 const api=async(path,user,body)=>{const r=await fetch(site+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
 const stamp=Date.now(),password='Sharing-check-123';
 const host=await api('/auth/signup',null,{username:'tablehost_'+stamp,password,display_name:'Table host'});
 const guest=await api('/auth/signup',null,{username:'tableguest_'+stamp,password,display_name:'Table guest'});
 const room=await api('/rooms',host,{name:'Table copy check'});
 const game=await api(`/test-games/${room.room_id}`,host,{name:'Shared Flush',game_type:'flush',player_count:2});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
  await context.addInitScript(({site,host,room})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:host,room,game:'flush'})),{site,host,room});
  const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(site);
  const card=p.getByTestId(`table-card-${game.match_id}`);
  await card.getByRole('button',{name:'Copy table code',exact:true}).click();
  const code=await p.evaluate(()=>navigator.clipboard.readText());assert.equal(code,`table:${room.room_id}:${game.match_id}`);
  await card.getByRole('button',{name:'Copy table link',exact:true}).click();
  const link=await p.evaluate(()=>navigator.clipboard.readText());const url=new URL(link);assert.equal(url.searchParams.get('room'),room.room_id);assert.equal(url.searchParams.get('match'),game.match_id);
  assert.equal(await p.getByTestId('live-game-overlay').count(),0);
  for(const width of [320,1280]){await p.setViewportSize({width,height:844});await p.waitForTimeout(100);const b=await card.getByRole('button',{name:'Copy table link',exact:true}).boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width);}
  for(const value of [code,link]){
   const ctx=await browser.newContext({viewport:{width:390,height:844}});
   await ctx.addInitScript(({site,guest})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:guest,room:null,game:null})),{site,guest});
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(site);
   await page.getByRole('button',{name:'Join with code',exact:true}).click();await page.getByLabel('Room or table code',{exact:true}).fill(value);await page.getByRole('button',{name:'Join room',exact:true}).click();
   await page.getByTestId('live-game-overlay').waitFor();
   const snapshot=await api(`/test-games/${room.room_id}?match_id=${game.match_id}`,guest);assert.equal(snapshot.match_id,game.match_id);assert.equal(snapshot.table.current_user.is_seated,false);
   await ctx.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS: table clipboard code/link, no accidental entry, mobile/desktop fit, both invitations open correct table without taking a seat');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
