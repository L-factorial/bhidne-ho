import test from 'node:test';
import assert from 'node:assert/strict';
import {gameRequestFeedback} from '../src/multiplayer/gameRequestFeedback.ts';
import {updateHandDrawer} from '../src/multiplayer/handDrawer.ts';
import {retryingError, playerError} from '../src/multiplayer/playerError.ts';
import {ui} from '../src/i18n/copy.ts';
import i18n from '../src/i18n/core.ts';

test('shared game feedback uses progress for pending writes and reconnection in both languages', async()=>{
 try {
  for(const language of ['en','ne']) {
   await i18n.changeLanguage(language);
   for(const message of [retryingError(Error('gateway unavailable')),ui('feedback.please_wait_confirmation'),ui('feedback.confirming_your_action')]) {
    assert.deepEqual(gameRequestFeedback(message,false,true,false),{error:'',active:true});
   }
   assert.deepEqual(gameRequestFeedback('',true,true,false),{error:'',active:true});
   assert.deepEqual(gameRequestFeedback('',false,false,false),{error:'',active:true});
   assert.deepEqual(gameRequestFeedback('',false,true,false),{error:'',active:false});
   assert.deepEqual(gameRequestFeedback('',false,false,true),{error:'',active:false});
  }
 } finally { await i18n.changeLanguage('en'); }
});

test('retry activity preserves the pending Call Break card and manually collapsed hand',()=>{
 const state={open:false,entered:'turn',deal:'deal',pending:{card:'AS',revision:5}};
 const feedback=gameRequestFeedback(retryingError(Error('offline')),false,false,false);
 const input={deal:'deal',turn:'turn',revision:5,hand:['AS','KH'],busy:false,error:feedback.error};
 assert.deepEqual(updateHandDrawer(state,input),state);
 const confirmed=updateHandDrawer(state,{...input,revision:6,hand:['KH']});
 assert.equal(confirmed.pending,null);assert.equal(confirmed.open,false);
});

test('actual rejections remain actionable and recover the Call Break hand',()=>{
 const denial=playerError({code:'NOT_YOUR_TURN'});
 const feedback=gameRequestFeedback(denial,false,true,false);
 assert.deepEqual(feedback,{error:denial,active:false});
 const state={open:false,entered:'turn',deal:'deal',pending:{card:'AS',revision:5}};
 const next=updateHandDrawer(state,{deal:'deal',turn:'turn',revision:5,hand:['AS','KH'],busy:false,error:feedback.error});
 assert.equal(next.open,true);assert.equal(next.pending,null);
});

test('an authoritative own-turn view clears only the obsolete turn rejection in every game',async()=>{
 const {clearObsoleteTurnError}=await import('../src/multiplayer/gameRequestFeedback.ts');
 try {
  for(const language of ['en','ne']) {
   await i18n.changeLanguage(language);
   const denial=playerError({code:'NOT_YOUR_TURN'});
   const invalidBet=playerError(Error('Bet must be a whole number at least the current minimum.'));
   for(const game_type of ['flush','marriage','callbreak']) {
    const view={status:'playing',game_type,your_player_id:1,game:{turn:{player_id:2}},
      flush:{public:{current_player_id:'2'}},marriage:{public:{current_player_id:'2'}}};
    assert.equal(clearObsoleteTurnError(denial,view),denial);
    if(game_type==='callbreak')view.game.turn.player_id=1;
    else view[game_type].public.current_player_id='1';
    assert.equal(clearObsoleteTurnError(denial,view),'');
    assert.equal(gameRequestFeedback(denial,false,true,false,view).error,'');
    assert.equal(clearObsoleteTurnError(invalidBet,view),invalidBet);
    assert.equal(clearObsoleteTurnError(denial,{...view,your_player_id:null}),denial);
   }
  }
 } finally { await i18n.changeLanguage('en'); }
});
