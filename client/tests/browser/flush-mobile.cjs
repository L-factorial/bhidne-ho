const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://localhost:8083';
async function api(path, user, body) {
 const r = await fetch('http://localhost:8000'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json(); assert.ok(r.ok,JSON.stringify(data)); return data;
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const users=await Promise.all([0,1].map(i=>api('/auth/guest',null,{display_name:`Mobile ${i}`})));
 const room=await api('/rooms',users[0],{name:`Mobile ${Date.now()}`});
 for(const u of users) await api(`/rooms/${room.room_id}/enter`,u,{});
 const root=`/test-games/${room.room_id}`;
 const game=await api(root,users[0],{game_type:'flush',player_count:2});
 await api(root+'/join',users[1],{match_id:game.match_id});
 const pages=[],errors=[];
 for(let i=0;i<2;i++) {
 const context=await browser.newContext({viewport:{width:i?390:360,height:i?844:640}});
 await context.addInitScript(({user,room})=>sessionStorage.setItem('bhidne.session.v1:http://localhost:8000',JSON.stringify({session:user,room,game:'flush'})),{user:users[i],room});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(site);pages.push(page);
 await page.getByTestId('flush-mobile-header').waitFor();
 assert.equal(await page.getByTestId('live-game-overlay').getByRole('button',{name:'Copy game link',exact:true}).count(),0);
 assert.equal(await page.getByTestId('live-game-overlay').getByRole('button',{name:'Profile',exact:true}).count(),0);
 }
 const button=(page,name)=>page.getByRole('button',{name,exact:true});
 async function preparationPulse(page,label) {
   const control=page.getByTestId('flush-center-preparation');
   const action=control.getByRole('button',{name:label,exact:true});
   await action.waitFor();
   const arena=await page.getByTestId('flush-arena').boundingBox(), bounds=await control.boundingBox();
   assert.ok(Math.abs(bounds.y+bounds.height/2-arena.y-arena.height/2)<2,'preparation controls centered vertically');
   assert.ok(Math.abs(bounds.x+bounds.width/2-arena.x-arena.width/2)<2,'preparation controls centered horizontally');
   const values=[];
   for(let i=0;i<5;i++) { values.push(await action.getByTestId('action-cue').evaluate(el=>Number(getComputedStyle(el).opacity))); await page.waitForTimeout(250); }
   assert.ok(Math.max(...values)-Math.min(...values)>0.03,`${label} pulses in the center`);
   assert.equal(await button(page,label).count(),1,'no duplicate preparation control');
 }
 assert.equal(await pages[0].getByTestId('flush-mobile-menu').count(),0);
 await pages[0].getByTestId('flush-formation-controls').getByRole('button',{name:'Lock game',exact:true}).waitFor();
 const center=pages[0].getByTestId('flush-center-start');
 await center.waitFor(); assert.equal(await center.isEnabled(),true);
 assert.equal(await pages[1].getByTestId('flush-center-start').count(),0);
 const cue=center.getByTestId('action-cue'), opacity=[];
 for(let i=0;i<5;i++) { opacity.push(await cue.evaluate(el=>Number(getComputedStyle(el).opacity))); await pages[0].waitForTimeout(250); }
 assert.ok(Math.max(...opacity)-Math.min(...opacity)>0.03,'center Lock game fades in and out');
 await pages[0].emulateMedia({reducedMotion:'reduce'}); await pages[0].waitForTimeout(200);
 assert.equal(await cue.evaluate(el=>Number(getComputedStyle(el).opacity)),1);
 await pages[0].emulateMedia({reducedMotion:'no-preference'});
 assert.equal(await button(pages[0],'Back to room').count(),0);
 assert.equal(await button(pages[0],'End table').count(),0);
 await button(pages[0],'Table menu').click();
 await button(pages[0],'Back to room').waitFor();
 await button(pages[0],'End table').waitFor();
 assert.equal(await pages[0].getByTestId('flush-mobile-menu').getByRole('button',{name:'Lock game',exact:true}).count(),0);
 await button(pages[0],'Table menu').click();
 await pages[0].screenshot({path:process.env.TEMP+'/flush-visible-lock.png'});
 await center.click();
 await center.filter({hasText:'Start game'}).waitFor();
 await center.click();
 let state=await api(root,users[0]);
 await preparationPulse(pages[Number(state.game.turn.player_id)-1],'Deal cards');
 await button(pages[Number(state.game.turn.player_id)-1],'Deal cards').click();
 await new Promise(r=>setTimeout(r,1500)); state=await api(root,users[0]);
 await preparationPulse(pages[Number(state.game.turn.player_id)-1],'Cut in half');
 await preparationPulse(pages[Number(state.game.turn.player_id)-1],'Skip cut');
 assert.equal(await pages[1-(Number(state.game.turn.player_id)-1)].getByTestId('flush-center-preparation').count(),0);
 await button(pages[Number(state.game.turn.player_id)-1],'Skip cut').click();
 await new Promise(r=>setTimeout(r,2000)); state=await api(root,users[0]);
 const first=Number(state.game.turn.player_id)-1, p=pages[first];
 await button(p,'Expand your card area').click();
 await button(p,'Collapse your card area').waitFor();
 await p.getByTestId('flush-hand-content').getByRole('button',{name:'Poke the table',exact:true}).waitFor();
 await button(p,'Poke the table').click();
 await p.getByRole('button',{name:'Close poke composer',exact:true}).click();
 await button(p,'Table menu').click();
 assert.equal(await p.getByTestId('flush-mobile-menu').getByRole('button',{name:'Poke the table',exact:true}).count(),0);
 await button(p,'Table menu').click();
 await button(p,'Collapse your card area').click();
 assert.equal(await button(p,'Poke the table').count(),0);
 await p.waitForTimeout(1200);assert.equal(await p.getByTestId('flush-hand-content').count(),0);
 await button(p,'Expand your card area').click();
 await button(p,'See cards').click();await p.waitForTimeout(1600);
 await button(p,'Collapse your card area').waitFor();
 await button(p,'Press and hold to see cards').waitFor();
 // A rejected action must leave the panel open and show the error.
 await p.route('**/test-games/*/action',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'Test rejected bet'})}));
 await p.getByRole('button',{name:/^Bet minimum/}).click();
 await p.getByTestId('flush-hand-content').getByText('Test rejected bet',{exact:true}).waitFor();
 await p.unroute('**/test-games/*/action');
 await p.getByRole('button',{name:/^Bet minimum/}).click();
 await button(p,'Expand your card area').waitFor();
 const next=pages[1-first];await button(next,'Expand your card area').waitFor();
 await p.getByTestId('chat-dock').waitFor({state:'hidden'});
 const header=await p.getByTestId('flush-mobile-header').boundingBox();assert.ok(header.height<=64);
 const dock=await p.getByTestId('flush-mobile-hand').boundingBox();assert.ok(dock.height<=54);
 await p.screenshot({path:process.env.TEMP+'/flush-mobile-collapsed.png'});
 await button(p,'Expand your card area').click();await p.screenshot({path:process.env.TEMP+'/flush-mobile-expanded.png'});
 await p.setViewportSize({width:1280,height:900});await p.getByTestId('flush-sidebar').waitFor();
 assert.equal(await p.getByTestId('flush-mobile-hand').count(),0);await p.getByTestId('flush-hand-dock').waitFor();
 assert.equal(await p.getByTestId('game-footer').getByRole('button',{name:'Copy game link',exact:true}).count(),1);
 assert.equal(await p.getByTestId('live-game-overlay').getByRole('button',{name:'Profile',exact:true}).count(),0);
 assert.equal(await button(p,'Back to room').count(),0);
 await button(p,'Table menu').click();
 await button(p,'Back to room').waitFor();
 await button(p,'Table menu').click();
 assert.equal(await p.getByTestId('flush-sidebar').getByRole('button',{name:'Poke the table',exact:true}).count(),0);
 assert.equal(await p.getByTestId('flush-hand-dock').getByRole('button',{name:'Poke the table',exact:true}).count(),1);
 await button(next,'Fold').click();
 await pages[0].getByTestId('flush-round-result').waitFor();
 await pages[0].setViewportSize({width:360,height:640});
 await button(pages[0],'Close final show').click();
 const restart=pages[0].getByTestId('flush-center-start');
 await restart.filter({hasText:'Lock the table to start another game'}).waitFor();
 const restartOpacity=[];
 for(let i=0;i<5;i++) { restartOpacity.push(await restart.getByTestId('action-cue').evaluate(el=>Number(getComputedStyle(el).opacity))); await pages[0].waitForTimeout(250); }
 assert.ok(Math.max(...restartOpacity)-Math.min(...restartOpacity)>0.03,'restart fades in and out');
 assert.equal(await pages[1].getByTestId('flush-center-start').count(),0);
 await pages[0].screenshot({path:process.env.TEMP+'/flush-center-restart.png'});
 await restart.click(); await restart.filter({hasText:'Start game'}).waitFor(); await restart.click();
 await pages[0].getByTestId('flush-center-start').waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log('PASS mobile header/menu, manual collapse, turn expansion, reveal, rejected/accepted bets, paused chat, desktop layout.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
