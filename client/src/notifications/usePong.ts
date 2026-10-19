import {useCallback} from 'react';
import {useForegroundSound} from './useForegroundSound';
export function usePong(){
  const {prepare,play:cue}=useForegroundSound();
  const play=useCallback(()=>cue('chat',`chat:${Date.now()}`),[cue]);
  return {prepare,play};
}
