import {DistributedUiIntent} from './DistributedUiIntent';
import type {DistributedRootRuntime} from './DistributedRoot';
import {useEffect} from 'react';
import {request} from './api';
import type {Session} from './session';
import {matchesNotification, type ActionNotification, type NotificationAction} from './notificationActions';

const listeners=new Set<(session:Session,ids:string[])=>void>();
export function onNotificationsAcknowledged(listener:(session:Session,ids:string[])=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}

// Capture specific IDs so new or unrelated notifications are never cleared.
export async function acknowledgeNotificationAction(session:Session, action:NotificationAction, signal?:AbortSignal) {
  const rows=await request<ActionNotification[]>('/notifications',session,undefined,signal);
  const ids=rows.filter(row=>matchesNotification(row,action)).map(row=>row.id);
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);await request('/notifications/read',session,{ids:batch},signal);
    if(!signal?.aborted)for(const listener of listeners)listener(session,batch);
  }
}
const distributedIntents=new WeakMap<DistributedRootRuntime,DistributedUiIntent>();
export async function acknowledgeDistributedNotificationAction(root:DistributedRootRuntime,session:Session,action:NotificationAction,signal:AbortSignal){
  const recipient=await root.reads.recipient(signal);
  const rows=await root.reads.history('social',recipient.lane_id,signal);
  const ids=rows.filter(row=>matchesNotification({id:row.id,kind:String(row.kind),read:row.read===true,payload:row.payload as ActionNotification['payload'],actor:{user_id:String(row.actor_id)}},action)).map(row=>String(row.id));
  let intent=distributedIntents.get(root);if(!intent){intent=new DistributedUiIntent(root.session);distributedIntents.set(root,intent);}
  const target={kind:'recipient' as const,recipient_id:session.user_id.replace(/^user-/,'')};
  const saved=root.session.command('notification-actions').request;
  if(saved?.body.command==='read-notifications')await intent.run('notification-actions',saved.target,saved.body,signal,async()=>undefined);
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);await intent.run('notification-actions',target,{command:'read-notifications',payload:{ids:batch}},signal,async()=>undefined);
    if(!signal.aborted)for(const listener of listeners)listener(session,batch);
  }
}
export function useNotificationAction(session:Session, action:NotificationAction|null,root?:DistributedRootRuntime) {
  const key=JSON.stringify(action);
  useEffect(()=>{
    if(!action)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{if(root)await acknowledgeDistributedNotificationAction(root,session,action!,controller.signal);else await acknowledgeNotificationAction(session,action!,controller.signal);}catch{/* Retry while the destination remains visible. */}
      if(!controller.signal.aborted)timer=setTimeout(poll,5000);
    }
    void poll();return()=>{controller.abort();clearTimeout(timer);};
  },[session.user_id,session.token,key,root]);
}
