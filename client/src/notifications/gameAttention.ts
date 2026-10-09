import type { RoomSnapshot } from '../screens/LiveGameTable';
import { marriageSuggestions } from '../multiplayer/marriage.ts';
import type { UiKey } from '../i18n/catalogs.ts';

export type GameAttention = { key:string; title:UiKey; detail:UiKey; required:boolean; opportunities:UiKey[] };
// Presentation uses authorized snapshots only. Suggestions never grant actions.
export function gameAttention(snapshot:RoomSnapshot|null, local?:{marriage:boolean;maal:boolean;tunnela:boolean}):GameAttention|null {
  if(!snapshot?.match_id || snapshot.status==='ended')return null;
  if(snapshot.game_type==='callbreak' && snapshot.session?.controls.some(c=>c.seat_id===snapshot.your_player_id && c.mode==='auto'))return null;
  const s=snapshot, mine=s.marriage?.private;
  const opportunities:UiKey[]=[];
  const cue=(kind:string,title:UiKey,detail:UiKey,required=false):GameAttention=>({
    key:JSON.stringify([s.match_id,kind]),title,detail,required,opportunities});
  if(s.game?.finished || s.status==='finished')return cue('finished','common.attention_result','common.attention_view_result');
  if(s.game_type==='marriage' && mine && s.status==='playing'){
    const own=s.marriage!.public.players.find(p=>p.player_id===mine.player_id);
    if(own?.folded)return null;
    if(local?.tunnela)opportunities.push('common.attention_tunnela');
    if(mine.actions.kinds.includes('declare_tunnelas'))return cue('declare','common.attention_declare','common.attention_declare_detail',true);
    if(!s.marriage!.public.tunnela_declaration_pending){
      const committed=new Set(own?.shown_melds.flatMap(m=>m.card_ids));
      const suggestion=marriageSuggestions(mine.hand.filter(c=>!committed.has(c.card_id)));
      if(local){
        if(local.maal)opportunities.push('common.attention_maal');
        if(local.marriage)opportunities.unshift('common.attention_marriage');
      }else if(!own?.has_seen_maal && own?.route==='unqualified'){
        if(suggestion.dublees.length)opportunities.push('common.attention_dublee');
        if(suggestion.normal.length || suggestion.dublees.length)opportunities.push('common.attention_maal');
      }
      if(!local && mine.maal){
        const rank=(n:number|null)=>n===14?1:n;
        if([mine.maal.tiplu,mine.maal.jhiplu,mine.maal.poplu].every(face=>mine.hand.some(c=>
          c.card_type==='standard'&&c.suit===face.suit&&rank(c.rank)===rank(face.rank))))
          opportunities.unshift('common.attention_marriage');
      }
    }
    if(mine.player_id===s.marriage!.public.current_player_id){
      const kinds=mine.actions.kinds;
      if(kinds.includes('draw'))return cue('draw','common.attention_turn','common.attention_draw',true);
      if(kinds.includes('discard'))return cue('discard','common.attention_turn','common.attention_discard',true);
      if(kinds.includes('finish'))return cue('finish','common.attention_turn','common.attention_finish',true);
    }
  }else if(s.game_type==='flush'){
    if(s.flush?.public.settlement)return cue(`flush-round:${s.flush.public.round_number}`,'common.attention_round','common.attention_view_result');
    if(s.flush?.public.pending_side_show?.target_id===String(s.your_player_id) && s.flush.private?.actions.kinds.some(k=>k==='accept_side_show'||k==='decline_side_show'))
      return cue('side-show','common.attention_action','common.attention_side_show',true);
    if(s.flush?.public.pending_side_show?.accepted && s.flush.public.pending_side_show.requester_id===String(s.your_player_id) && s.flush.private?.actions.kinds.includes('reveal_side_show'))
      return cue('side-show-reveal','common.attention_action','common.attention_side_show',true);
    if(s.your_player_id && s.flush?.public.current_player_id===String(s.your_player_id) && s.flush.private?.actions.kinds.length)
      return cue('bet','common.attention_turn','common.attention_bet',true);
  }else if(s.your_player_id && s.game?.turn.player_id===s.your_player_id){
    if(s.game.phase==='BIDDING' && s.deal?.players?.find(p=>p.player_id===s.your_player_id)?.bid == null)
      return cue(`bid:${s.deal?.deal_number}:${s.deal?.attempt}`,'common.attention_turn','common.attention_bid',true);
    if(s.game.phase==='PLAYING')return cue('play','common.attention_turn','common.attention_play',true);
  }
  if(s.private?.can_accept_hand)return cue('review','common.attention_review','common.attention_review_detail',true);
  if(s.round_review)return cue(`round:${s.round_review.deal_number}`,'common.attention_round','common.attention_view_result');
  if(opportunities.length)return cue(`opportunity:${opportunities.join(',')}`,opportunities[0],'common.attention_review_options');
  return null;
}
