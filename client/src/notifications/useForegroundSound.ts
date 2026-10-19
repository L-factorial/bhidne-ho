import {useCallback,useEffect,useRef} from 'react';
import {AppState} from 'react-native';
import {useAudioPlayer} from 'expo-audio';
import {foregroundSounds,soundCues,type SoundCue} from './soundCues';
const sources={turn:require('../../assets/sounds/turn.wav'),invitation:require('../../assets/sounds/invitation.wav'),chat:require('../../assets/sounds/chat.wav'),joined:require('../../assets/sounds/joined.wav'),left:require('../../assets/sounds/left.wav'),started:require('../../assets/sounds/started.wav'),round:require('../../assets/sounds/round.wav'),won:require('../../assets/sounds/won.wav'),move:require('../../assets/sounds/move.wav')};
let stopCurrent:(()=>void)|null=null;
export function useForegroundSound(){
  const player=useAudioPlayer(null),alive=useRef(true);
  useEffect(()=>{
    alive.current=true;
    const subscription=AppState.addEventListener('change',state=>{if(state!=='active'){foregroundSounds.cancel();try{stopCurrent?.();}catch{}}});
    return()=>{alive.current=false;subscription.remove();};
  },[]);
  const prepare=useCallback(()=>{},[]);
  const play=useCallback((kind:SoundCue,key:string)=>{
    if(AppState.currentState!=='active')return;
    foregroundSounds.request(kind,key,()=>{
      if(!alive.current||AppState.currentState!=='active')return;
      try{stopCurrent?.();player.replace(sources[kind]);player.volume=soundCues[kind].volume;player.play();stopCurrent=()=>{if(alive.current)player.pause();};}catch{/* Audio must never interrupt gameplay. */}
    });
  },[player]);
  return {prepare,play};
}
