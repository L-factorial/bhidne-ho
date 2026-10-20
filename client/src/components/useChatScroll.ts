import {useCallback,useEffect,useRef} from 'react';
import type {ScrollView,NativeSyntheticEvent,NativeScrollEvent} from 'react-native';

/** Follow new messages near the bottom; a sent message always brings you back. */
export function useChatScroll(scope:string,last:{id:string;sender_id:string}|undefined,userId:string){
  const scroll=useRef<ScrollView>(null),following=useRef(true),frame=useRef(0);
  const showLatest=useCallback(()=>{
    following.current=true;
    cancelAnimationFrame(frame.current);
    frame.current=requestAnimationFrame(()=>scroll.current?.scrollToEnd({animated:false}));
  },[]);
  useEffect(()=>{showLatest();},[scope,showLatest]);
  useEffect(()=>{
    if(last?.sender_id===userId||following.current)showLatest();
  },[last?.id,userId,showLatest]);
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
  const onScroll=useCallback(({nativeEvent:e}:NativeSyntheticEvent<NativeScrollEvent>)=>{
    following.current=e.contentSize.height-e.contentOffset.y-e.layoutMeasurement.height<40;
  },[]);
  const followLayout=useCallback(()=>{if(following.current)scroll.current?.scrollToEnd({animated:false});},[]);
  return {scroll,showLatest,onScroll,followLayout};
}
