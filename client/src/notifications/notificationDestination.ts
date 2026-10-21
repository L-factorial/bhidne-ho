import type {Invitation} from '../multiplayer/invitations.ts';

const actions=new Set(['ready','bid','play','shuffle','cut','deal','review','declare','draw','discard','finish','bet','side_show']);
const friends=new Set(['friend_request','friend_requested','friend_accepted','friend_rejected']);
const id=(value:unknown,max:number)=>typeof value==='string'&&new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value);
export function pushDestination(data:unknown,eventId:string):Invitation|null {
  if(!data||typeof data!=='object')return null;
  const value=data as Record<string,unknown>;
  if(value.type!=='bhidne_notification'||!id(value.user_id,128)||typeof value.kind!=='string')return null;
  const kind=value.kind;
  if(kind==='chat'&&value.scope!==undefined){
    if(value.room_id===''&&value.scope!=='direct')return null;
    if(value.scope==='room'&&value.match_id!==undefined)return null;
    if(['table','game'].includes(String(value.scope))&&!value.match_id)return null;
  }
  if(!actions.has(kind)&&!friends.has(kind)&&!['chat','poke','room_invitation','game_invitation'].includes(kind))return null;
  const target:Invitation={roomId:'',recipientId:value.user_id as string,notificationKind:kind,eventId};
  if(friends.has(kind)||(kind==='chat'&&value.room_id==='')){
    if(typeof value.other_user_id!=='string'||!/^user-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.other_user_id)||value.match_id!==undefined)return null;
    return {...target,otherUserId:value.other_user_id,scope:kind==='chat'?'direct':undefined};
  }
  if(!id(value.room_id,64)||(value.match_id!==undefined&&!id(value.match_id,128)))return null;
  if((actions.has(kind)||kind==='game_invitation'||kind==='poke')&&!value.match_id)return null;
  if(value.scope!==undefined&&!['room','table','game'].includes(String(value.scope)))return null;
  if(value.game_id!==undefined&&(typeof value.game_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.game_id)))return null;
  return {...target,gameId:value.game_id as string|undefined,roomId:value.room_id as string,matchId:value.match_id as string|undefined,
    scope:kind==='chat'?(value.scope as Invitation['scope']??(value.match_id?'table':'room')):undefined};
}
export function recipientMatches(target:Invitation,userId:string|null){return !target.recipientId||target.recipientId===userId;}
export function isNotificationActivity(target:Invitation){return !!target.notificationKind&&!target.notificationKind.endsWith('invitation');}
