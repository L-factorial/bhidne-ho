import {useEffect,useState} from 'react';
import {AppState} from 'react-native';

/** Pause display reads in hidden tabs and backgrounded apps; resume immediately. */
export function useVisibleActivity(active:boolean) {
  const [foreground,setForeground]=useState(AppState.currentState!=='background'&&AppState.currentState!=='inactive');
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>sub.remove();},[]);
  return active&&foreground;
}
