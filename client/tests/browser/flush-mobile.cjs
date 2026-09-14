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
 await button(pages[0],'Table menu').click();
 await button(pages[0],'Lock game').click();
 await button(pages[0],'Start game').click();
 await button(pages[0],'Table menu').click();
 let state=await api(root,users[0]);
 await button(pages[Number(state.game.turn.player_id)-1],'Deal cards').click();
 await new Promise(r=>setTimeout(r,1500)); state=await api(root,users[0]);
 await button(pages[Number(state.game.turn.player_id)-1],'Skip cut').click();
 await new Promise(r=>setTimeout(r,2000)); state=await api(root,users[0]);
 const first=Number(state.game.turn.player_id)-1, p=pages[first];
 await button(p,'Collapse your cards').waitFor();
 await button(p,'Collapse your cards').click();
 await p.waitForTimeout(1200);assert.equal(await p.getByTestId('flush-hand-content').count(),0);
 await button(p,'Expand your cards').click();
 await button(p,'See cards').click();await p.waitForTimeout(1600);
 await button(p,'Collapse your cards').waitFor();
 await button(p,'Peek at all three cards').click();
 await button(p,'Hide all three cards').waitFor();
 // A rejected action must leave the panel open and show the error.
 await p.route('**/test-games/*/action',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'Test rejected bet'})}));
 await p.getByRole('button',{name:/^Bet minimum/}).click();
 await p.getByTestId('flush-hand-content').getByText('Test rejected bet',{exact:true}).waitFor();
 await p.unroute('**/test-games/*/action');
 await p.getByRole('button',{name:/^Bet minimum/}).click();
 await button(p,'Expand your cards').waitFor();
 const next=pages[1-first];await button(next,'Collapse your cards').waitFor();
 await p.getByTestId('chat-dock').waitFor({state:'hidden'});
 const header=await p.getByTestId('flush-mobile-header').boundingBox();assert.ok(header.height<=64);
 const dock=await p.getByTestId('flush-mobile-hand').boundingBox();assert.ok(dock.height<=54);
 await p.screenshot({path:process.env.TEMP+'/flush-mobile-collapsed.png'});
 await button(p,'Expand your cards').click();await p.screenshot({path:process.env.TEMP+'/flush-mobile-expanded.png'});
 await p.setViewportSize({width:1280,height:900});await p.getByTestId('flush-sidebar').waitFor();
 assert.equal(await p.getByTestId('flush-mobile-hand').count(),0);await p.getByTestId('flush-hand-dock').waitFor();
 assert.equal(await p.getByTestId('game-footer').getByRole('button',{name:'Copy game link',exact:true}).count(),1);
 assert.deepEqual(errors,[]);console.log('PASS mobile header/menu, manual collapse, turn expansion, reveal, rejected/accepted bets, paused chat, desktop layout.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
