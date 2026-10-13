export type NotificationAction = {kind:'direct';otherUserId:string}|{kind:'table';roomId:string;matchId:string}|{kind:'room';roomId:string}|{kind:'friend';otherUserId:string};
export type ActionNotification = {id:string;kind:string;read:boolean;actor?:{user_id:string};payload?:{scope?:string;room_id?:string;match_id?:string}};
export function matchesNotification(row:ActionNotification, action:NotificationAction):boolean {
  if(row.read)return false;
  if(action.kind==='friend')return row.actor?.user_id===action.otherUserId && ['friend_request','friend_requested','friend_accepted','friend_rejected'].includes(row.kind);
  if(!['chat','poke'].includes(row.kind))return false;
  if(action.kind==='direct')return row.payload?.scope==='direct'&&row.actor?.user_id===action.otherUserId;
  if(row.payload?.scope==='direct'||row.payload?.room_id!==action.roomId)return false;
  return action.kind==='table'?row.payload?.match_id===action.matchId:!row.payload?.match_id;
}
