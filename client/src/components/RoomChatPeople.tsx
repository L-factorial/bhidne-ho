import {retryingError} from '../multiplayer/playerError';
import {ChatTableSeparator} from './ChatTableSeparator';
import {useEffect, useState} from 'react';
import {View} from 'react-native';
import {AppText as Text} from './AppText';
import {OnlinePeopleStrip, type ChatPerson} from './OnlinePeopleStrip';
import {request} from '../multiplayer/api';
import type {Session} from '../multiplayer/session';
import {fonts, useTheme} from '../theme';
import {ui} from '../i18n/copy';

export function RoomChatPeople({roomId,session,onlineIds}: {roomId:string;session:Session;onlineIds?:string[]}) {
  const {colors}=useTheme();
  const [members,setMembers]=useState<ChatPerson[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    setMembers([]);setError('');
    async function refresh() {
      try {
        const rows=await request<ChatPerson[]>(`/rooms/${encodeURIComponent(roomId)}/members`,session,undefined,controller.signal);
        if(!controller.signal.aborted){setMembers(rows);setError('');}
      } catch (failure) {if(!controller.signal.aborted)setError(retryingError(failure,ui('social.members_unavailable')));}
      finally {if(!controller.signal.aborted)timer=setTimeout(refresh,5000);}
    }
    void refresh();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[roomId,session.token]);
  const people=onlineIds===undefined?members:members.filter(member=>onlineIds.includes(member.user_id));
  return <View testID="room-chat-people" style={{paddingBottom:0}}>
    <Text style={{fontFamily:fonts.medium,fontSize:13,color:colors.text}}>{ui('common.online')}{onlineIds===undefined?' · —':` · ${people.length}`}</Text>
    {people.length>0&&<OnlinePeopleStrip people={people} onlineIds={onlineIds}/>}
    <ChatTableSeparator/>
    {!!error&&<Text activity accessibilityRole="alert" style={{fontFamily:fonts.body,fontSize:12,color:colors.textMuted}}>{error}</Text>}
  </View>;
}
