// Isolated snapshots: verify the draw/show/see-Maal/finish flow without live writes.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./game-stats.cjs');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8129';
const face = card_id => ({card_id,card_type:'standard',rank:({J:11,Q:12,K:13,A:14}[card_id.slice(3,-1)]||Number(card_id.slice(3,-1))),suit:card_id.slice(-1),deck_index:Number(card_id[1])});
const initial = ['2C','3C','4C','5D','6D','7D','JH','QH','KH'];
const rest = ['2S','2H','2D','6C','6H','6S','9C','9D','9S','KC','KD','KS'];
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  for(const width of [390,1280]) {
   let snapshot; const commands=[];
   const f=await fixture(browser,'marriage',4,width,false,s=>{
    snapshot=s; s.status='playing';s.game.finished=false;
    s.marriage.public.current_player_id='1';s.marriage.public.phase='must_draw';s.marriage.public.tunnela_declaration_pending=false;
    Object.assign(s.marriage.public.players[0],{route:'unqualified',shown_melds:[],has_seen_maal:false,hand_count:21,folded:false});
    s.marriage.private.hand=[...initial,...rest].map(v=>face('D0:'+v));s.marriage.private.maal=null;
    s.marriage.private.actions={kinds:['draw','fold'],drawable_sources:['stock'],discardable_card_ids:[],blocked_sources:[]};
   });
   await f.context.route(site+'/test-games/room/action',async route=>{
    const action=route.request().postDataJSON();commands.push(action.command);
    f.change(s=>{
     snapshot=s;const mine=s.marriage.private,pub=s.marriage.public;
     if(action.command==='DRAW_CARD'){
      assert.equal(pub.phase,'must_draw');mine.hand.push(face('D0:AH'));pub.phase='must_discard';pub.players[0].hand_count=22;
      mine.actions={kinds:['discard','fold','show_initial_melds','show_dublees'],drawable_sources:[],discardable_card_ids:mine.hand.map(c=>c.card_id),blocked_sources:[]};
     }else if(action.command==='SHOW_INITIAL_MELDS'){
      assert.equal(pub.phase,'must_discard');Object.assign(pub.players[0],{route:'normal',shown_melds:action.payload.melds,has_seen_maal:true});
      mine.maal={tiplu:{rank:8,suit:'H'},jhiplu:{rank:7,suit:'H'},poplu:{rank:9,suit:'H'}};mine.actions.kinds=['discard','finish','fold'];
     }else{
      assert.equal(action.command,'FINISH');assert.equal(pub.phase,'must_discard');assert.equal(pub.players[0].has_seen_maal,true);
      s.status='finished';s.game.finished=true;pub.status='finished';pub.winner='1';mine.actions.kinds=[];
     }
     s.game.revision++;pub.revision=s.game.revision;
    });
    await route.fulfill({json:{...snapshot,action_ack:{command_id:action.command_id,status:'accepted',revision:snapshot.game.revision}}});
   });
   const page=f.page;page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);
   await page.getByTestId('hand-attention-collapsed').click();
   const eligibility=page.getByTestId('marriage-maal-eligibility');
   await eligibility.getByRole('button',{name:'Maal eligible · Draw before showing',exact:true}).click();
   const preview=page.getByTestId('marriage-maal-preview');
   assert.ok(await preview.getByRole('button',{name:'Confirm & show',exact:true}).isDisabled());
   await preview.getByText('Draw your card on your turn before you can show and see Maal.',{exact:true}).waitFor();
   assert.ok(await page.getByTestId('marriage-hand-maal').isDisabled());
   assert.equal(await page.getByTestId('marriage-see-maal-step').count(),0);
   // The draw controls remain available even while viewing an eligible declaration.
   await page.getByTestId('marriage-hand-draw').getByRole('button',{name:'Tap to take from deck',exact:true}).click();
   await preview.getByRole('button',{name:'Confirm & show',exact:true}).waitFor();
   await page.waitForFunction(()=>{const b=[...document.querySelectorAll('[role="button"]')].find(n=>n.getAttribute('aria-label')==='Confirm & show');return b&&b.getAttribute('aria-disabled')!=='true';},null,{timeout:15000});
   await preview.getByRole('button',{name:'Confirm & show',exact:true}).click();
   const see=page.getByTestId('marriage-see-maal-step');await see.waitFor();
   assert.ok(await see.getByRole('button',{name:'Continue',exact:true}).isDisabled());
   await page.getByTestId('marriage-see-maal-card').click();
   await see.getByRole('button',{name:'Continue',exact:true}).click();await see.waitFor({state:'hidden'});
   await page.getByTestId('marriage-win-eligibility').getByRole('button').click();
   const win=page.getByTestId('marriage-win-preview');
   assert.ok(await win.getByRole('button',{name:'Show Marriage',exact:true}).isEnabled());
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/test-games/room/action')&&r.request().postDataJSON().command==='FINISH'),win.getByRole('button',{name:'Show Marriage',exact:true}).click()]);
   assert.deepEqual(commands,['DRAW_CARD','SHOW_INITIAL_MELDS','FINISH']);assert.deepEqual(f.errors,[]);
   await f.context.close();console.log(`PASS Marriage draw/show/see-Maal/same-turn finish at ${width}px`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
