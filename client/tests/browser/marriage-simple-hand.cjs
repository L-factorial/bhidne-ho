const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8098';
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${rank}${suit}`,rank,suit,deck_index:deck,card_type:'standard'});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const routeName of ['normal','dublee']){
  const snapshot=JSON.parse(fs.readFileSync('/tmp/bhidne-social-marriage.json'));
  const room={room_id:'room',name:'Marriage test',members:['u0','u1','u2','u3'],connected_members:['u0','u1','u2','u3']};
  snapshot.room_id='room';snapshot.game.turn={player_id:1};
  const pub=snapshot.marriage.public,mine=snapshot.marriage.private;
  pub.current_player_id='1';pub.phase='must_discard';pub.status='active';
  mine.hand=routeName==='normal'?[2,3,4].flatMap(r=>[0,1,2].map(d=>card(r,'H',d))).concat(['S','D'].flatMap(s=>[2,4,6,8,10,12].map(r=>card(r,s))))
    :['H','C'].flatMap(s=>[2,4,6,8].flatMap(r=>[card(r,s),card(r,s,1)] )).concat([2,4,6,8,10].map(r=>card(r,'S')));
  mine.actions.kinds=['discard','show_initial_melds','show_dublees'];mine.actions.discardable_card_ids=mine.hand.map(c=>c.card_id);
  pub.players.forEach(p=>{p.route='unqualified';p.shown_melds=[];p.has_seen_maal=false;});mine.maal=null;
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  await ctx.addInitScript(({site,room})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'mock'},room,game:'marriage'})),{site,room});
  const commands=[];let reject=true;
  await ctx.route(site+'/**',async r=>{
   const path=new URL(r.request().url()).pathname;
   if(path==='/'||path.startsWith('/_expo/')||path.startsWith('/assets/')||path==='/favicon.ico')return r.continue();
   let data=path==='/rooms'?[room]:[];
   if(path.startsWith('/test-games/')){
    if(path.endsWith('/action')){
     const cmd=r.request().postDataJSON();commands.push(cmd);
     if(cmd.command==='DRAW_CARD'){
      assert.equal(cmd.payload.source,'stock');
      pub.phase='must_discard';mine.actions.kinds=['discard','show_initial_melds','show_dublees'];
      pub.revision++;snapshot.game.revision=pub.revision;
      snapshot.action_ack={match_id:snapshot.match_id,command_id:cmd.command_id,status:'accepted',revision:pub.revision};
      return r.fulfill({json:snapshot});
     }
     if(reject)return r.fulfill({status:409,json:{detail:'Hand changed. Please review again.'}});
     const groups=cmd.payload.melds||cmd.payload.pairs;
     const ids=groups.flatMap(g=>g.card_ids);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>mine.hand.some(c=>c.card_id===id)));
     const own=pub.players.find(p=>p.player_id==='1');own.route=routeName;own.shown_melds=groups;own.has_seen_maal=true;
     mine.maal={tiplu:{rank:8,suit:'C'},jhiplu:{rank:7,suit:'C'},poplu:{rank:9,suit:'C'}};
     pub.revision++;snapshot.game.revision=pub.revision;
     snapshot.action_ack={match_id:snapshot.match_id,command_id:cmd.command_id,status:'accepted',revision:pub.revision};
    }data=snapshot;
   }await r.fulfill({json:data});
  });
  await ctx.routeWebSocket(site.replace('http','ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
  const page=await ctx.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(site);await page.getByRole('button',{name:/Return to table/}).first().click();
  const btn=name=>page.getByRole('button',{name,exact:true});
  assert.equal(await page.getByTestId('marriage-maal-spot').isDisabled(),true);
  assert.equal(await page.getByTestId('marriage-maal-spot').getAttribute('aria-label'),'Maal hidden');
  assert.equal(await page.getByTestId('marriage-maal-check-1').count(),0);
  pub.phase='must_draw';mine.actions.kinds=['draw'];mine.actions.drawable_sources=['stock'];
  pub.revision++;snapshot.game.revision=pub.revision;
  await btn('Expand your card area').waitFor();await btn('Expand your card area').click();
  await page.getByTestId('marriage-hand-draw').waitFor();
  assert.equal(await btn('Tap to take from discard').isDisabled(),true);
  await btn('Tap to take from deck').click();
  await page.getByTestId('marriage-hand-draw').waitFor({state:'detached'});
  assert.equal(commands.at(-1).command,'DRAW_CARD');commands.length=0;
  await btn('Reveal cards').click();
  await page.getByTestId('marriage-discard-prompt').waitFor();
  await btn('Maal eligible · Show for Maal').waitFor();
  if(routeName==='normal'){
    const legal=[...mine.actions.kinds], original=[...mine.hand];
    pub.current_player_id='2';snapshot.game.turn.player_id=2;mine.actions.kinds=[];pub.revision++;snapshot.game.revision=pub.revision;
    await btn('Expand your card area').click();
    await btn('Maal eligible · View options').waitFor();
    await btn('Maal eligible · View options').click();
    await page.getByTestId('marriage-maal-preview').waitFor();
    assert.equal(await btn('Confirm & show').isDisabled(),true);
    assert.equal(commands.length,0);
    await btn('Back to your cards').click();
    assert.equal(await btn('Collapse your card area').getByText(/Your turn/).count(),0);
    pub.current_player_id='1';snapshot.game.turn.player_id=1;mine.actions.kinds=legal;pub.revision++;snapshot.game.revision=pub.revision;
    await btn('Maal eligible · Show for Maal').waitFor();
    mine.hand=original.slice(1);pub.revision++;snapshot.game.revision=pub.revision;
    await btn('Maal not eligible').waitFor();assert.equal(await btn('Maal not eligible').isDisabled(),true);
    mine.hand=original;pub.revision++;snapshot.game.revision=pub.revision;
    await btn('Maal eligible · Show for Maal').waitFor();
  }
  assert.equal(await btn('Arrange').count(),0);
  await page.getByRole('tab',{name:'Dublee',exact:true}).click();
  const firstCard=page.getByTestId('marriage-hand').getByRole('button').first();
  await firstCard.click();const selected=await firstCard.getAttribute('aria-label');
  await page.getByRole('tab',{name:'Sequence / Tunnela',exact:true}).click();
  assert.equal(await page.getByTestId('marriage-hand').getByRole('button',{name:selected,exact:true}).getAttribute('aria-pressed'),'true');
  const packed=await page.getByTestId('marriage-hand').evaluate(el=>{
    const cards=[...el.querySelectorAll('[role=button]')].map(card=>card.getBoundingClientRect());
    const columns=Math.floor((el.getBoundingClientRect().width+5)/53);
    return cards.every((card,i)=>Math.abs(card.y-cards[Math.floor(i/columns)*columns].y)<1);
  });
  assert.equal(packed,true,'Suit boundaries must not force a new row');
  await btn('Maal eligible · Show for Maal').click();
  await page.getByTestId('marriage-maal-preview').waitFor();
  assert.equal(commands.length,0);
  assert.ok(await btn('Next option').isEnabled());await btn('Next option').click();await btn('Previous option').click();
  await page.screenshot({path:'/tmp/marriage-'+routeName+'-preview.png'});
  await btn('Back to your cards').click();
  assert.equal(await page.getByTestId('marriage-hand').getByRole('button',{name:selected,exact:true}).getAttribute('aria-pressed'),'true');
  await btn('Maal eligible · Show for Maal').click();await btn('Confirm & show').click();
  await page.getByTestId('marriage-maal-preview').getByText('Hand changed. Please review again.',{exact:true}).waitFor();
  reject=false;await btn('Confirm & show').click();
  await page.getByTestId('marriage-win-eligibility').getByRole('button').waitFor();
  assert.equal(await page.getByTestId('marriage-maal-preview').count(),0);
  assert.equal(commands.at(-1).command,routeName==='normal'?'SHOW_INITIAL_MELDS':'SHOW_DUBLEES');
  await btn('Hide cards').click();assert.equal(await page.getByTestId('marriage-win-eligibility').getByRole('button').isDisabled(),true);
  await btn('Collapse your card area').click();
  const check=page.getByTestId('marriage-maal-check-1');
  await check.click();
  const shown=page.getByTestId('marriage-shown-cards');await shown.waitFor();
  assert.match(await shown.innerText(),routeName==='normal'?/3 sequences/:/7 Dublees/);
  assert.equal(await page.getByTestId('marriage-player-details').count(),0,'badge opens only declared cards');
  assert.equal(await page.getByTestId('marriage-maal-check-2').count(),0);
  await btn('Close shown cards').click();await shown.waitFor({state:'hidden'});
  const maalSpot=page.getByTestId('marriage-maal-spot');
  await maalSpot.waitFor();
  assert.equal(await maalSpot.getAttribute('aria-label'),'Tap to see the Maal');
  await maalSpot.tap();
  assert.equal(await maalSpot.getAttribute('aria-label'),'Tap to hide the Maal');
  assert.match(await maalSpot.innerText(),/8♣/);
  await maalSpot.tap();
  assert.equal(await maalSpot.getAttribute('aria-label'),'Tap to see the Maal');
  assert.ok(!(await maalSpot.innerText()).includes('8♣'));
  assert.equal(commands.length,2,'flipping Maal is local and sends no game command');
  assert.deepEqual(errors,[]);await ctx.close();console.log('PASS '+routeName+': arrangement, selection, options, rejection and confirmed Maal');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
