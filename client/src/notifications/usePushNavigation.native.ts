import {useEffect,useRef} from 'react';
import * as Notifications from 'expo-notifications';
import {readSession} from '../multiplayer/session';
import {apiUrl} from '../multiplayer/api';
import {notificationTarget} from './pushTypes';
import type {Invitation} from '../multiplayer/invitations';
export function usePushNavigation(open:(target:Invitation)=>void){
  const latest=useRef(open);latest.current=open;
  useEffect(()=>{
    const seen=new Set<string>();
    function consume(response:Notifications.NotificationResponse|null){
      if(!response)return;
      const notification=response.notification;
      const target=notificationTarget(notification.request.content.data,readSession(apiUrl)?.session.user_id??null);
      const event=String(notification.request.content.data?.notification_id||notification.request.identifier);
      if(!target){void Notifications.clearLastNotificationResponseAsync().catch(()=>{});return;}
      if(seen.has(event))return;
      seen.add(event);if(seen.size>50)seen.delete(seen.values().next().value!);
      latest.current(target);void Notifications.clearLastNotificationResponseAsync().catch(()=>{});
    }
    const listener=Notifications.addNotificationResponseReceivedListener(consume);
    void Notifications.getLastNotificationResponseAsync().then(consume).catch(()=>{});
    return()=>listener.remove();
  },[]);
}
