import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {AppState,Platform} from 'react-native';
import * as Notifications from 'expo-notifications';
import {getIosPushNotificationServiceEnvironmentAsync,getIosApplicationReleaseTypeAsync,ApplicationReleaseType} from 'expo-application';
import {registerIosDevice,PushSetupError} from './nativeRegistration';
import {request} from '../multiplayer/api';
import {readAuthValue,writeAuthValue} from '../auth/storage';
import {isCurrentSession} from '../multiplayer/session';
import {apiUrl} from '../multiplayer/api';
import {playerError} from '../multiplayer/playerError';
import i18n from '../i18n/core';
import {defaultPushPreferences,notificationTarget,type PushState,type PushPreferences,type PushProviderProps} from './pushTypes';
const Context=createContext<PushState|null>(null);
let foreground:{user:string;match:string|null;sound:boolean}|null=null;
Notifications.setNotificationHandler({handleNotification:async notification=>{
  const target=notificationTarget(notification.request.content.data,foreground?.user??null);
  const show=!!target&&(!foreground?.match||target.matchId!==foreground.match);
  return {shouldShowBanner:show,shouldShowList:show,shouldSetBadge:false,shouldPlaySound:show&&!!foreground?.sound};
}});
function deviceId(){
  const key='bhidne.push.installation.v1';let id=readAuthValue(key);
  if(!id){
    id=globalThis.crypto?.randomUUID?.()??'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const value=Math.floor(Math.random()*16);return (c==='x'?value:(value&3)|8).toString(16);
    });writeAuthValue(key,id);
  }
  return id;
}
export function PushProvider({session,viewedMatch,children}:PushProviderProps){
  const [available,setAvailable]=useState(false),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [preferences,setPreferences]=useState<PushPreferences>(defaultPushPreferences);
  const current=useRef({session,viewedMatch,preferences});current.current={session,viewedMatch,preferences};
  const operation=useRef<object|null>(null);
  const generation=useRef(0);
  const provider=Platform.OS==='ios'?'apns':'fcm';
  const optedKey=session?`bhidne.push.enabled.v1:${apiUrl}:${session.user_id}`:'';
  async function register(token?:string,actor=current.current.session,signal?:AbortSignal){
    if(!actor)return;
    const active=()=>!signal?.aborted&&isCurrentSession(apiUrl,actor);
    const send=async(native:string,environment:'development'|'production')=>{
      if(!active())return;
      await request(`/me/push/devices/${deviceId()}`,actor,{provider,token:native,environment,
        locale:i18n.resolvedLanguage==='ne'?'ne':'en',timezone_offset:new Date().getTimezoneOffset()},signal);
    };
    if(Platform.OS==='ios')return registerIosDevice({
      token:async()=>token??String((await Notifications.getDevicePushTokenAsync()).data),
      environment:getIosPushNotificationServiceEnvironmentAsync,
      isStoreBuild:async()=>await getIosApplicationReleaseTypeAsync()===ApplicationReleaseType.APP_STORE,
      active,register:send,
    });
    let native:string;
    try{native=token??String((await Notifications.getDevicePushTokenAsync()).data);}
    catch{throw new PushSetupError('PUSH_TOKEN_FAILED');}
    await send(native,'production');
  }
  async function activity(active=AppState.currentState==='active'){
    const value=current.current;if(!value.session)return;
    await request(`/me/push/devices/${deviceId()}/activity`,value.session,{foreground:active,
      viewed_match:active?value.viewedMatch:null,locale:i18n.resolvedLanguage==='ne'?'ne':'en',timezone_offset:new Date().getTimezoneOffset()});
  }
  useEffect(()=>{
    generation.current++;operation.current=null;
    const abort=new AbortController();setAvailable(false);setEnabled(false);setBusy(false);setError('');
    foreground=session?{user:session.user_id,match:viewedMatch,sound:preferences.sound}:null;
    if(!session)return()=>{generation.current++;abort.abort();foreground=null;};
    void (async()=>{
      const capability=await request<{providers:string[]}>('/auth/push/capabilities',session,undefined,abort.signal);
      if(abort.signal.aborted)return;
      const supported=capability.providers.includes(provider);setAvailable(supported);
      if(!supported)return;
      const prefs=await request<PushPreferences>('/me/push/preferences',session,undefined,abort.signal);
      if(abort.signal.aborted)return;setPreferences(prefs);
      if(readAuthValue(optedKey)==='0')return;
      await run(async active=>{
        const live=()=>!abort.signal.aborted&&active();
        const granted=await permissionForDevice(live);
        if(!live())return;
        if(!granted){
          await request(`/me/push/devices/${deviceId()}`,session,undefined,abort.signal,'DELETE');
          if(live())throw new PushSetupError('PUSH_PERMISSION_REQUIRED');
          return;
        }
        await register(undefined,session,abort.signal);
        if(live()){writeAuthValue(optedKey,'1');setEnabled(true);await activity();}
      });
    })().catch(failure=>{if(!abort.signal.aborted)setError(playerError(failure));});
    return()=>{generation.current++;abort.abort();foreground=null;};
  },[session?.user_id,session?.token]);
  useEffect(()=>{foreground=session?{user:session.user_id,match:viewedMatch,sound:preferences.sound}:null;},[session?.user_id,viewedMatch,preferences.sound]);
  useEffect(()=>{
    if(!enabled||!session)return;
    const abort=new AbortController();
    const report=()=>{void activity().catch(()=>{});};report();
    const timer=setInterval(report,25000);
    const app=AppState.addEventListener('change',state=>{
      void activity(state==='active').catch(()=>{});
      if(state==='active')void Notifications.getPermissionsAsync().then(permission=>{
        if(abort.signal.aborted)return;
        if(permission.status!=='granted')void disable(false);
        else if(!abort.signal.aborted)void register(undefined,session,abort.signal).catch(()=>{});
      }).catch(()=>{});
    });
    const token=Notifications.addPushTokenListener(value=>{void register(String(value.data),session,abort.signal).catch(()=>{});});
    return()=>{abort.abort();clearInterval(timer);app.remove();token.remove();};
  },[enabled,session?.user_id,session?.token,viewedMatch]);
  async function run(task:(active:()=>boolean)=>Promise<void>){
    if(operation.current)return;
    const marker={},version=generation.current,actor=current.current.session;
    const active=()=>version===generation.current&&!!actor&&isCurrentSession(apiUrl,actor);
    operation.current=marker;setBusy(true);setError('');
    try{await task(active);}catch(failure){if(active())setError(playerError(failure));}
    finally{if(operation.current===marker){operation.current=null;if(active())setBusy(false);}}
  }
  async function permissionForDevice(active:()=>boolean){
    if(Platform.OS==='android'){
      await Notifications.setNotificationChannelAsync('game-actions',{name:'Game actions',importance:Notifications.AndroidImportance.HIGH,sound:'default'});
      if(!active())return false;
      await Notifications.setNotificationChannelAsync('game-actions-silent',{name:'Silent game actions',importance:Notifications.AndroidImportance.HIGH,sound:null,enableVibrate:false});
    }
    if(!active())return false;
    let permission:Notifications.NotificationPermissionsStatus;
    try{
      permission=await Notifications.getPermissionsAsync();
      if(!active())return false;
      // An OS denial is not an app opt-out. Do not repeatedly prompt on sign-in.
      if(permission.status==='undetermined')permission=await Notifications.requestPermissionsAsync({ios:{allowAlert:true,allowSound:true,allowBadge:false}});
    }catch{throw new PushSetupError('PUSH_PERMISSION_FAILED');}
    return active()&&permission.status==='granted';
  }
  async function enable(){await run(async active=>{
    if(!session||!available)return;
    if(!await permissionForDevice(active)){
      if(active())throw new PushSetupError('PUSH_PERMISSION_REQUIRED');
      return;
    }
    await register(undefined,session);if(!active())return;writeAuthValue(optedKey,'1');setEnabled(true);await activity();
  });}
  async function disable(explicit=true){await run(async active=>{
    if(!session)return;
    await request(`/me/push/devices/${deviceId()}`,session,undefined,undefined,'DELETE');
    if(!active())return;if(explicit)writeAuthValue(optedKey,'0');setEnabled(false);await Notifications.dismissAllNotificationsAsync();
  });}
  async function save(value:PushPreferences){await run(async active=>{
    if(!session)return;
    const saved=await request<PushPreferences>('/me/push/preferences',session,value,undefined,'PATCH');if(active())setPreferences(saved);
  });}
  return <Context.Provider value={{available,enabled,busy,error,preferences,enable,disable,save}}>{children}</Context.Provider>;
}
export function usePush(){return useContext(Context)!;}
