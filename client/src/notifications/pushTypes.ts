import type {Session} from '../multiplayer/session';
export type PushPreferences={actions:boolean;invitations:boolean;sound:boolean;quiet_start:number|null;quiet_end:number|null};
export const defaultPushPreferences:PushPreferences={actions:true,invitations:true,sound:true,quiet_start:null,quiet_end:null};
export type PushState={available:boolean;enabled:boolean;busy:boolean;error:string;preferences:PushPreferences;
  enable:()=>Promise<void>;disable:()=>Promise<void>;save:(preferences:PushPreferences)=>Promise<void>};
export function notificationTarget(data:unknown,userId:string|null):{roomId:string;matchId?:string;otherUserId?:string}|null {
  if(!userId||!data||typeof data!=='object')return null;
  const value=data as Record<string,unknown>;
  if(value.type==='bhidne_notification'&&value.user_id===userId&&value.kind==='chat'&&value.room_id===''&&value.match_id===undefined&&typeof value.other_user_id==='string'&&/^user-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.other_user_id))return {roomId:'',otherUserId:value.other_user_id};
  if(value.type!=='bhidne_notification'||value.user_id!==userId||typeof value.room_id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(value.room_id))return null;
  if(value.match_id!==undefined&&(typeof value.match_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.match_id)))return null;
  return {roomId:value.room_id,...(typeof value.match_id==='string'?{matchId:value.match_id}:{})};
}
export type PushProviderProps={session:Session|null;viewedMatch:string|null;children:React.ReactNode};
