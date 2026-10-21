import {useEffect,useRef} from 'react';
import * as Notifications from 'expo-notifications';
import {pushDestination} from './notificationDestination';
import type {Invitation} from '../multiplayer/invitations';
export function usePushNavigation(open:(target:Invitation)=>void){
  const latest=useRef(open);latest.current=open;
  useEffect(()=>{
    const seen=new Set<string>();
    let active=true,liveResponse=false;
    function consume(response:Notifications.NotificationResponse|null){
      if(!active||!response||response.actionIdentifier!==Notifications.DEFAULT_ACTION_IDENTIFIER)return;
      const notification=response.notification;
      const event=String(notification.request.content.data?.notification_id||notification.request.identifier);
      const target=pushDestination(notification.request.content.data,event);
      if(!target)return;
      if(seen.has(event))return;
      seen.add(event);if(seen.size>50)seen.delete(seen.values().next().value!);
      latest.current(target);
    }
    const listener=Notifications.addNotificationResponseReceivedListener(response=>{liveResponse=true;consume(response);});
    void Notifications.getLastNotificationResponseAsync().then(response=>{if(!liveResponse)consume(response);}).catch(()=>{});
    return()=>{active=false;listener.remove();};
  },[]);
  return (eventId?:string)=>{
    if(!eventId)return;
    const response=Notifications.getLastNotificationResponse();
    const event=response&&String(response.notification.request.content.data?.notification_id||response.notification.request.identifier);
    if(event===eventId){try{Notifications.clearLastNotificationResponse();}catch{/* A later launch can safely retry the retained destination. */}}
  };
}
