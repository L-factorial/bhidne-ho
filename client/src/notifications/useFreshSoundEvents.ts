import {useCallback,useEffect,useRef} from 'react';
import {AppState} from 'react-native';
import {useLiveEffects} from '../multiplayer/LivePresentationContext';
/** Hydration and the first refresh after foregrounding establish a silent baseline. */
export function useFreshSoundEvents(scope:string){
  const live=useLiveEffects();
  const state=useRef<{scope:string;ids:Set<string>;epoch:number}|null>(null);
  useEffect(()=>{
    const reset=()=>{state.current=null;};
    const subscription=AppState.addEventListener('change',reset);
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',reset);
    return()=>{subscription.remove();if(typeof document!=='undefined')document.removeEventListener('visibilitychange',reset);};
  },[]);
  return useCallback((ids:string[],historical=false)=>{
    const old=state.current;
    const frame=live.window?.snapshot()??live;
    const fresh=frame.active&&frame.ready&&old?.epoch===frame.epoch&&old?.scope===scope&&!historical?ids.filter(id=>!old.ids.has(id)):[];
    const known=old?.scope===scope?old.ids:new Set<string>();
    ids.forEach(id=>known.add(id));
    while(known.size>1000)known.delete(known.values().next().value!);
    state.current={scope,ids:known,epoch:frame.epoch};return fresh;
  },[scope,live.window,live.epoch]);
}
