// Isolated browser fixtures; no production accounts or writes.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,390,1280]){
   const f=await fixture(browser,'flush',4,width),{page}=f;
   await page.getByTestId('flush-own-cards').waitFor();
   // Seen hands are immediately face up; the button and tap overlay share state.
   const hide=page.getByTestId('flush-actions').getByRole('button',{name:'Hide cards',exact:true});
   await hide.waitFor();await hide.click();
   const see=page.getByTestId('flush-actions').getByRole('button',{name:'See cards',exact:true});
   await see.waitFor();await see.click();await hide.waitFor();
   await page.getByTestId('flush-own-cards').getByRole('button',{name:'Hide cards',exact:true}).click();
   await see.waitFor();await see.click();
   const dock=await page.getByTestId('flush-hand-dock').boundingBox(),viewport=await page.getByTestId('flush-play-viewport').boundingBox();
   assert.ok(viewport.y+viewport.height<=dock.y+2,'table viewport must end above the expanded hand');
   await page.getByTestId('hand-attention-expanded').click();
   await page.getByTestId('hand-attention-collapsed').waitFor();
   await page.waitForTimeout(250);
   const arena=await page.getByTestId('flush-arena').boundingBox();
   for(const node of await page.locator('[data-testid^="flush-seat-"]').all()){
    const box=await node.boundingBox();assert.ok(box.x>=arena.x-1&&box.x+box.width<=arena.x+arena.width+1);assert.ok(box.y>=arena.y&&box.y+box.height<=arena.y+arena.height+1,JSON.stringify({arena,box,id:await node.getAttribute('data-testid')}));
   }
   // Off-turn blind players retain See Cards. Pending activity uses the line.
   f.change(s=>{s.flush.public.players[0].visibility='blind';s.flush.private.cards=[];s.flush.private.actions.kinds=['see_cards'];s.flush.public.current_player_id='2';s.game.turn.player_id=2;s.game.revision++;});
   await page.getByTestId('hand-attention-collapsed').click();
   await page.getByTestId('flush-actions').getByRole('button',{name:'See cards',exact:true}).waitFor();
   assert.ok(await page.getByTestId('flush-actions').getByRole('button',{name:'See cards',exact:true}).isEnabled());
   await page.screenshot({path:`/private/tmp/bhidne-game-ux-flush-${width}.png`});
   assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log(`PASS Flush ${width}: reveal/hide, off-turn visibility, table/dock bounds.`);
  }
  for(const kind of ['callbreak','marriage'])for(const width of [320,390,1280]){
   const f=await fixture(browser,kind,4,width),{page}=f;
   const header=page.getByTestId('hand-attention-expanded');if(await header.count()&&await header.isVisible())await header.click();await page.waitForTimeout(200);
   const table=page.getByTestId(kind==='callbreak'?'card-table':'marriage-player-grid'),bounds=await table.boundingBox();
   for(const seat of await table.locator('[data-testid^="table-seat-"]').all()){
    const box=await seat.boundingBox();assert.ok(box.y>=bounds.y+10&&box.y+box.height<=bounds.y+bounds.height-10,JSON.stringify({kind,width,bounds,box}));
   }
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind} ${width}: full player rows and pulse clearance.`);
  }
  // Formation retains usable empty seats with the Start control in the center.
  for(const kind of ['callbreak','marriage','flush'])for(const phase of ['waiting','finished']){
   const f=await fixture(browser,kind,4,390,false,s=>{
    if(phase==='finished'&&kind==='callbreak'){s.status='finished';s.game={...s.game,finished:true,phase:'MATCH_COMPLETE',turn:{player_id:null},winners:[1]};}
    else if(phase==='finished'&&kind==='marriage'){s.status='finished';s.game={...s.game,finished:true,turn:{player_id:null},winners:[1]};}
    else{s.status=phase;s.game=null;delete s.deal;delete s.private;delete s.marriage;delete s.flush;}
    s.players=s.players.slice(0,2);s.capacity=4;s.is_creator=true;
    s.table.phase=phase==='finished'&&kind!=='flush'?'COMPLETED':'OPEN';s.table.seated_players=s.table.seated_players.slice(0,2).map((p,i)=>({...p,position_id:i+1}));s.table.current_user.can_start=true;s.table.current_user.can_next_match=true;
    if(s.flush_settings)s.flush_settings.locked=false;
   });
   const {page}=f;
   await page.waitForTimeout(250);
   const canvas=await page.getByTestId(kind==='flush'?'flush-arena':'pregame-table').boundingBox();
   for(const move of await page.getByTestId(/^move-seat-/).all()){const box=await move.boundingBox();assert.ok(box.y+box.height<=canvas.y+canvas.height,JSON.stringify({kind,phase,canvas,box}));}
   const requests=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/table/move-player'))requests.push(request.postDataJSON());});
   // Drag an occupied seat over the other player, preserving a single atomic command.
   await page.getByTestId('move-seat-1').scrollIntoViewIfNeeded();
   const source=await page.getByTestId('move-seat-1').boundingBox(),target=await page.getByTestId('move-seat-2').boundingBox();
   await page.mouse.move(source.x+source.width/2,source.y-22);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y-22,{steps:12});await page.mouse.up();
   await page.waitForTimeout(500);
   assert.equal(requests.length,1,`${kind}: dragging must submit exactly one seat swap`);
   assert.equal(requests[0].position_id,2);assert.equal(requests[0].source_position,1);
   await page.getByTestId('invite-seat-3').click();await page.getByTestId('seat-invite-popover').waitFor();
   assert.ok(await page.getByRole('textbox',{name:'Find player to invite',exact:true}).isVisible());
   await page.screenshot({path:`/private/tmp/bhidne-game-ux-${kind}-invite.png`});
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind} ${phase}: drag swap and empty-seat invitation beside center Start.`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
