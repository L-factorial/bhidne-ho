import {useCallback,useEffect} from 'react';
import {foregroundSounds,soundCues,type SoundCue} from './soundCues';
let audio:AudioContext|null=null;
let playing:OscillatorNode[]=[];
function stop(){for(const node of playing){try{node.stop();}catch{}}playing=[];}
function prepare(){try{audio??=new AudioContext();void audio.resume().catch(()=>{});}catch{}}
export function useForegroundSound(){
  useEffect(()=>{
    const unlock=()=>{if(document.visibilityState==='visible')prepare();};
    const visibility=()=>{if(document.hidden){foregroundSounds.cancel();stop();}};
    document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);
    document.addEventListener('visibilitychange',visibility);
    return()=>{document.removeEventListener('pointerdown',unlock);document.removeEventListener('keydown',unlock);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  const play=useCallback((kind:SoundCue,key:string)=>{
    if(document.hidden||audio?.state!=='running')return;
    foregroundSounds.request(kind,key,()=>{
      if(document.hidden||audio?.state!=='running')return;
      stop();const cue=soundCues[kind],context=audio;
      cue.notes.forEach((frequency,index)=>{
        const tone=context.createOscillator(),gain=context.createGain(),start=context.currentTime+index*cue.duration;
        tone.frequency.value=frequency;tone.type='sine';
        gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(cue.volume,start+0.005);
        gain.gain.exponentialRampToValueAtTime(0.001,start+cue.duration*0.9);
        tone.connect(gain);gain.connect(context.destination);playing.push(tone);
        tone.start(start);tone.stop(start+cue.duration);
        tone.onended=()=>{tone.disconnect();gain.disconnect();playing=playing.filter(node=>node!==tone);};
      });
    });
  },[]);
  return {prepare,play};
}
