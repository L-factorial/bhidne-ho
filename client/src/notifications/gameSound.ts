import type {RoomSnapshot} from '../screens/LiveGameTable';
import {requiredActionKey} from './gameNotification.ts';
import type {SoundCue} from './soundCues.ts';
export function gameSound(previous:RoomSnapshot|null,next:RoomSnapshot|null):SoundCue|null {
  if(!previous||!next||!next.match_id||previous.match_id!==next.match_id||next.status==='ended'||(next.game?.revision??0)<(previous.game?.revision??0))return null;
  const result=(s:RoomSnapshot)=>s.game?.finished||s.status==='finished'||s.marriage?.public.status==='finished'||!!s.flush?.public.settlement||!!s.round_review;
  const review=next.round_review&&next.round_review.deal_number!==previous.round_review?.deal_number;
  const flushRound=next.flush?.public.settlement&&next.flush.public.round_number!==previous.flush?.public.round_number;
  if(result(next)&&!result(previous)||review||flushRound)return 'round';
  // Public accepted state only. Detecting/selecting/skipping private cards is silent.
  const declarations=next.marriage?.public.players?.filter(player=>{
    const old=previous.marriage?.public.players?.find(p=>p.player_id===player.player_id);
    return !!old&&(player.initial_tunnelas?.length??0)>(old.initial_tunnelas?.length??0);
  });
  const qualified=next.marriage?.public.players?.some(player=>{
    const old=previous.marriage?.public.players?.find(p=>p.player_id===player.player_id);
    return !!old&&player.shown_melds?.length>0&&((old.shown_melds?.length??0)===0||!old.has_seen_maal&&player.has_seen_maal);
  });
  if(qualified)return 'maalDeclaration';
  if(declarations?.length)return 'tunnelaDeclaration';
  const action=requiredActionKey(next);
  if(action&&action!==requiredActionKey(previous))return 'turn';
  if(next.status==='playing'&&previous.status==='waiting')return 'started';
  if(next.round_review&&!previous.round_review)return 'round';
  const before=new Set(previous.players?.map(p=>p.user_id)),after=new Set(next.players?.map(p=>p.user_id));
  if([...after].some(id=>!before.has(id)))return 'joined';
  if([...before].some(id=>!after.has(id)))return 'left';
  const revision=next.game?.revision??0;
  if(revision<=(previous.game?.revision??0))return null;
  // Only actual attributed player actions qualify. Timers and snapshots don't.
  const actor=next.log?.filter(event=>event.revision>(previous.game?.revision??0)&&(event.player_id??event.payload?.player_id)!=null&&
    /DEALER_CARD_PICKED|CARD_PLAYED|BID_PLACED|BET_PLACED|PLAYER_FOLDED|CARD_DRAWN|CARD_DISCARDED|MELDS_SHOWN|SIDE_SHOW_REQUESTED|SIDE_SHOW_ACCEPTED|SIDE_SHOW_DECLINED|SIDE_SHOW_RESOLVED|SHOW_REQUESTED/.test(event.event)).at(-1);
  const actorId=actor?.player_id??actor?.payload?.player_id;
  const marriage=next.marriage?.moves?.filter(event=>event.revision>(previous.game?.revision??0)).at(-1)?.player_id;
  const flush=next.flush?.history?.filter(event=>event.revision>(previous.game?.revision??0)&&event.player_id!=null&&
    /CARDS_SEEN|BET_PLACED|PLAYER_FOLDED|SIDE_SHOW_|SHOW_REQUESTED/.test(event.kind)).at(-1)?.player_id;
  const marriageChange=next.marriage?.public.players?.some(player=>{
    if(player.player_id===String(next.your_player_id))return false;
    const old=previous.marriage?.public.players?.find(p=>p.player_id===player.player_id);
    return !!old&&JSON.stringify([old.hand_count,old.folded,old.has_seen_maal,old.shown_melds,old.initial_tunnelas])!==JSON.stringify([player.hand_count,player.folded,player.has_seen_maal,player.shown_melds,player.initial_tunnelas]);
  });
  return marriageChange||actorId!=null&&actorId!==next.your_player_id||flush!=null&&flush!==String(next.your_player_id)||marriage!=null&&marriage!==String(next.your_player_id)?'move':null;
}
