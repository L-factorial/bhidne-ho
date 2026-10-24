import {createContext,useContext,useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {LivePresentation} from './LivePresentation';

export const LivePresentationContext=createContext<LivePresentation|null>(null);
const defaultState={epoch:0,active:true,ready:true,since:0};
const noopSubscribe=()=>()=>{};
const defaultSnapshot=()=>defaultState;
export function useLiveEffects(){
  const window=useContext(LivePresentationContext);
  const state=useSyncExternalStore(window?.subscribe??noopSubscribe,window?.snapshot??defaultSnapshot);
  return {...state,window};
}
export function useLivePresentation(scope:string,connected:boolean){
  const window=useMemo(()=>new LivePresentation(),[scope]);
  const connection=useRef(connected);connection.current=connected;
  useEffect(()=>{
    const visible=()=>AppState.currentState!=='background'&&AppState.currentState!=='inactive'
      &&(typeof document==='undefined'||!document.hidden);
    const activity=()=>window.activity(connection.current&&visible());
    const online=()=>{window.reset();activity();};
    activity();
    const sub=AppState.addEventListener('change',activity);
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',activity);
    globalThis.addEventListener?.('online',online);
    return()=>{sub.remove();if(typeof document!=='undefined')document.removeEventListener('visibilitychange',activity);globalThis.removeEventListener?.('online',online);};
  },[window]);
  useEffect(()=>window.activity(connected&&AppState.currentState!=='background'&&AppState.currentState!=='inactive'
    &&(typeof document==='undefined'||!document.hidden)),[window,connected]);
  return window;
}
