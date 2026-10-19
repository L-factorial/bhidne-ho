import type {RoomSnapshot} from '../screens/LiveGameTable';
import {requiredActionKey} from './gameNotification.ts';
import type {SoundCue} from './soundCues.ts';
export function gameSound(previous:RoomSnapshot|null,next:RoomSnapshot|null):SoundCue|null {
  if(!previous||!next||!next.match_id||previous.match_id!==next.match_id||next.status==='ended'||(next.game?.revision??0)<(previous.game?.revision??0))return null;
  const result=(s:RoomSnapshot)=>s.game?.finished||s.status==='finished'||!!s.flush?.public.settlement;
  if(result(next)&&!result(previous))return next.game?.winners.includes(next.your_player_id??-1)||next.flush?.public.settlement?.winner_ids.includes(String(next.your_player_id))||next.marriage?.public.winner===String(next.your_player_id)?'won':'round';
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
    /DEALER_CARD_PICKED|CARD_PLAYED|BID_PLACED|BET_PLACED|PLAYER_FOLDED|CARD_DRAWN|CARD_DISCARDED|MELDS_SHOWN|TUNNELAS_DECLARED|SIDE_SHOW_REQUESTED|SIDE_SHOW_ACCEPTED|SIDE_SHOW_DECLINED|SIDE_SHOW_RESOLVED|SHOW_REQUESTED/.test(event.event)).at(-1);
  const actorId=actor?.player_id??actor?.payload?.player_id;
  const marriage=next.marriage?.moves?.filter(event=>event.revision>(previous.game?.revision??0)).at(-1)?.player_id;
  const flush=next.flush?.history?.filter(event=>event.revision>(previous.game?.revision??0)&&event.player_id!=null&&
    /CARDS_SEEN|BET_PLACED|PLAYER_FOLDED|SIDE_SHOW_|SHOW_REQUESTED/.test(event.kind)).at(-1)?.player_id;
  const marriageChange=next.marriage?.public.players?.some(player=>{
    if(player.player_id===String(next.your_player_id))return false;
    const old=previous.marriage?.public.players?.find(p=>p.player_id===player.player_id);
    return !!old&&JSON.stringify([old.hand_count,old.folded,old.has_seen_maal,old.shown_melds,old.initial_tunnelas,old.tunnela_declared])!==JSON.stringify([player.hand_count,player.folded,player.has_seen_maal,player.shown_melds,player.initial_tunnelas,player.tunnela_declared]);
  });
  return marriageChange||actorId!=null&&actorId!==next.your_player_id||flush!=null&&flush!==String(next.your_player_id)||marriage!=null&&marriage!==String(next.your_player_id)?'move':null;
}
