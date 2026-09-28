import type { Session } from './session';
export type UiRequest = <T>(path:string,session:Session|null,body?:object,signal?:AbortSignal,method?:'DELETE'|'PATCH')=>Promise<T>;
const owners=new Map<string,{token:string;request:UiRequest}>();
// Explicit authenticated routing, never a global fetch override. Registration is
// scoped to one account/token and removed before its journal owner is released.
export function registerRuntimeRequests(session:Session,request:UiRequest) {
  if(owners.has(session.user_id))throw Error('An API runtime already owns this account.');
  const value={token:session.token,request};owners.set(session.user_id,value);
  return ()=>{if(owners.get(session.user_id)===value)owners.delete(session.user_id);};
}
export function runtimeRequest(session:Session|null):UiRequest|null {
  const owner=session&&owners.get(session.user_id);
  if(!owner)return null;
  if(owner.token!==session!.token)throw Error('API session has changed.');
  return owner.request;
}
export function sharedPlatformPath(path:string,body?:object,method?:string) {
  const p=path.split('?')[0];
  return p.startsWith('/auth/') || p==='/me/profile' || p==='/me/appearance'
    || p==='/me/phrases'||p.startsWith('/me/phrases/')
    || (!body&&!method&&(p==='/friends'||p.startsWith('/players/')));
}
