import {useEffect,useMemo,useRef,useState} from 'react';
import {OutgoingChat,type ChatRecord} from '../multiplayer/outgoingChat';
export function useOutgoingChat<T extends ChatRecord>(account:string){
  const [,refresh]=useState(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  return useMemo(()=>new OutgoingChat<T>(()=>{if(alive.current)refresh(value=>value+1);}),[account]);
}
