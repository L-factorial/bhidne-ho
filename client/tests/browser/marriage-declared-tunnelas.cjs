// Isolated UI fixtures: no real game actions or invitations.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const card=(rank,suit,deck_index=0)=>({card_id:`D${deck_index}:${rank===14?'A':rank===12?'Q':rank===13?'K':rank}${suit}`,card_type:'standard',rank,suit,deck_index});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const count of [1,2,3])for(const width of [390,1280]){
  const triples=[[14,'S'],[5,'H'],[9,'C']].map(([rank,suit])=>[0,1,2].map(pack=>card(rank,suit,pack)));
  const hand=[...triples.flat(),...[[2,'S'],[4,'H'],[6,'D'],[8,'C'],[10,'S'],[12,'H'],[13,'D'],[2,'H'],[4,'D'],[6,'C'],[8,'S'],[10,'H']].map(([rank,suit])=>card(rank,suit))];
  const locked=triples.slice(0,count).flat().map(c=>c.card_id);
  const f=await fixture(browser,'marriage',4,width,false,s=>{
   const pub=s.marriage.public,mine=s.marriage.private;
   mine.hand=hand;mine.maal=null;mine.actions={kinds:['draw','show_initial_melds','fold'],drawable_sources:['stock','discard'],discardable_card_ids:[],blocked_sources:[]};
   pub.tunnela_declaration_pending=false;pub.phase='must_draw';pub.current_player_id='1';pub.winner=null;pub.scores=null;
   pub.players.forEach(p=>Object.assign(p,{route:'unqualified',has_seen_maal:false,shown_melds:[],initial_tunnelas:[],tunnela_declared:true}));
   pub.players[0].initial_tunnelas=triples.slice(0,count).map(cards=>({meld_type:'tunnela',card_ids:cards.map(c=>c.card_id)}));
  });
  const p=f.page,collapsed=p.getByTestId('hand-attention-collapsed');if(await collapsed.isVisible())await collapsed.click();
  const reveal=p.getByRole('button',{name:'Reveal all cards',exact:true});if(await reveal.isVisible())await reveal.click();
  const handView=p.getByTestId('marriage-hand');await handView.waitFor();
  const ids=()=>handView.locator('[data-testid^="marriage-hand-card-"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.testid.replace('marriage-hand-card-','')));
  for(let tab=0;tab<3;tab++){
   await p.getByTestId('marriage-view-tabs').getByRole('tab').nth(tab).click();
   await p.waitForTimeout(250); // Let hand-sheet layout settle before pointer coordinates.
   assert.deepEqual((await ids()).slice(0,locked.length),locked);
   if(count===3){
    const first=await p.getByTestId('marriage-declared-tunnela-0').boundingBox(),second=await p.getByTestId('marriage-declared-tunnela-1').boundingBox(),third=await p.getByTestId('marriage-declared-tunnela-2').boundingBox();
    assert.equal(first.y,second.y,'first two groups share a row');
    assert.ok(third.y>=first.y+first.height,'third Tunnela starts a separate row');
   }
   assert.equal((await ids()).length,21);assert.equal(new Set(await ids()).size,21);
   for(const id of locked)assert.ok(await p.getByTestId(`marriage-hand-card-${id}`).isDisabled());
   const before=await ids(),source=await p.getByTestId(`marriage-hand-card-${locked[0]}`).boundingBox();
   const target=await p.getByTestId(`marriage-hand-card-${hand.at(-1).card_id}`).boundingBox();
   await p.mouse.move(source.x+source.width/2,source.y+source.height/2);await p.mouse.down();
   await p.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:8});await p.mouse.up();
   assert.deepEqual(await ids(),before,'declared cards cannot be dragged or reordered');
  }
  const eligible=p.getByRole('button',{name:'Maal eligible',exact:true});await eligible.waitFor();assert.ok(await eligible.isEnabled());
  await p.getByTestId('marriage-view-tabs').getByRole('tab').first().click();
  const free=p.getByTestId(`marriage-hand-card-${hand.at(-1).card_id}`);await free.click();assert.equal(await free.getAttribute('aria-pressed'),'true');
  if(width===390){await handView.scrollIntoViewIfNeeded();await p.screenshot({path:`/private/tmp/marriage-declared-${count}-tunnelas.png`});}
  await p.getByRole('button',{name:'Hide cards',exact:true}).click();
  for(const id of locked)assert.equal(await p.getByTestId(`marriage-hand-card-${id}`).getAttribute('aria-label'),'Hidden card');
  assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${count} declared Tunnelas, ${width}px: locked prefix in all arrangements, no dragging/duplicates, Maal eligibility preserved, hidden faces stay hidden.`);
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
