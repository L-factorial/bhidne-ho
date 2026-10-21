import {useCallback,useEffect,useRef} from 'react';
import type {ScrollView,NativeSyntheticEvent,NativeScrollEvent} from 'react-native';

/** Follow new messages near the bottom; a sent message always brings you back. */
export function useChatScroll(scope:string,last:{id:string;sender_id:string}|undefined,userId:string,focusMessageId?:string){
  const scroll=useRef<ScrollView>(null),following=useRef(true),frame=useRef(0);
  const focused=useRef<string|null>(null),lastEvent=useRef<string|undefined>(undefined);
  const focusKey=focusMessageId?`${scope}:${focusMessageId}`:null;
  const pendingFocus=!!focusKey&&focused.current!==focusKey;
  const showLatest=useCallback(()=>{
    following.current=true;
    cancelAnimationFrame(frame.current);
    frame.current=requestAnimationFrame(()=>scroll.current?.scrollToEnd({animated:false}));
  },[]);
  useEffect(()=>{showLatest();},[scope,showLatest]);
  useEffect(()=>{
    const changed=lastEvent.current!==last?.id;lastEvent.current=last?.id;
    if(!pendingFocus&&((changed&&last?.sender_id===userId)||following.current))showLatest();
  },[last?.id,userId,showLatest,pendingFocus]);
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
  const onScroll=useCallback(({nativeEvent:e}:NativeSyntheticEvent<NativeScrollEvent>)=>{
    following.current=e.contentSize.height-e.contentOffset.y-e.layoutMeasurement.height<40;
  },[]);
  const followLayout=useCallback(()=>{if(!pendingFocus&&following.current)scroll.current?.scrollToEnd({animated:false});},[pendingFocus]);
  const focusLayout=useCallback((id:string,y:number)=>{
    if(id!==focusMessageId||!focusKey||focused.current===focusKey)return;
    focused.current=focusKey;following.current=false;cancelAnimationFrame(frame.current);
    frame.current=requestAnimationFrame(()=>scroll.current?.scrollTo({y:Math.max(0,y-12),animated:false}));
  },[focusMessageId,focusKey]);
  return {scroll,showLatest,onScroll,followLayout,focusLayout};
}
