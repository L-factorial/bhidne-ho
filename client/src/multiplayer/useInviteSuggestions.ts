import {useEffect,useRef,useState} from 'react';
import {request,apiUrl} from './api';
import {isCurrentSession,type Session} from './session';
import {playerError} from './playerError';
import {inviteSuggestions,type InvitePlayer} from './inviteSuggestions';

export function useInviteSuggestions(session:Session,query:string,selected:InvitePlayer[],disabled:boolean){
  const cache=useRef(new Map<string,InvitePlayer>());
  const identity=useRef(session.token);
  const [players,setPlayers]=useState<InvitePlayer[]>([]),[searching,setSearching]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if(identity.current!==session.token){cache.current.clear();identity.current=session.token;}
    const needle=query.trim(),controller=new AbortController();
    setError('');setSearching(false);
    if(needle.length<3||disabled){setPlayers([]);return;}
    setPlayers(inviteSuggestions(cache.current.values(),needle,session.user_id));
    setSearching(true);
    const timer=setTimeout(async()=>{
      try{
        // The production search checks committed profile versions behind its
        // cache. Exact-ID lookup retains support for pasted profile IDs.
        const path=needle.startsWith('user-')?'directory':'search';
        const search=needle.slice(0,path==='search'?50:64);
        let result=await request<InvitePlayer[]>(`/players/${path}?q=${encodeURIComponent(search)}`,session,undefined,controller.signal);
        if(controller.signal.aborted||!isCurrentSession(apiUrl,session))return;
        if(!result.length&&path==='search')result=await request<InvitePlayer[]>(`/players/directory?q=${encodeURIComponent(needle)}`,session,undefined,controller.signal);
        if(controller.signal.aborted||!isCurrentSession(apiUrl,session))return;
        for(const player of result){cache.current.delete(player.user_id);cache.current.set(player.user_id,player);}
        while(cache.current.size>100)cache.current.delete(cache.current.keys().next().value!);
        setPlayers(result);
      }catch(failure){if(!controller.signal.aborted&&isCurrentSession(apiUrl,session)){setPlayers([]);setError(playerError(failure));}}
      finally{if(!controller.signal.aborted)setSearching(false);}
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[session.token,session.user_id,query,disabled]);
  return {players:disabled?[]:inviteSuggestions(players,query,session.user_id,selected),searching,error};
}
