import {useEffect,useMemo,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {FriendsPanel,type FriendsTransport,type Message} from './FriendsPanel';
import {RoomLedger,type Ledger,type LedgerTransport} from './RoomLedger';
import {DisplayNameField} from './DisplayNameField';
import type {Session} from '../multiplayer/session';
import type {DistributedRootRuntime} from '../multiplayer/DistributedRoot';
import {useDistributedController,requireAccepted} from '../multiplayer/useDistributedController';
import type {CommandTarget} from '../multiplayer/DurableCommandClient';
import {useTheme} from '../theme';
import {usePlayerPhrases} from '../multiplayer/usePlayerPhrases';
import {PlayerPhrases} from './PlayerPhrases';
import type {TableInvitation} from '../multiplayer/DistributedReadClient';

function pair(actor:string,other:string):CommandTarget {
  const users=[actor.replace(/^user-/,''),other.replace(/^user-/,'')].sort();
  return {kind:'conversation',user_low:users[0],user_high:users[1]};
}
export function DistributedLedger({root,room,session}:{root:DistributedRootRuntime;room:string;session:Session}) {
  const {controller,state}=useDistributedController(root,'settlements');
  const reads=useMemo(()=>{
    const abort=new AbortController();
    return {abort,load:()=>root.reads.ledger<Ledger>(room,abort.signal)};
  },[root,room]);
  useEffect(()=>()=>reads.abort.abort(),[reads]);
  const transport:LedgerTransport={load:reads.load,busy:!controller||state.busy,error:state.error,
    start:(table_id,game_id)=>requireAccepted(controller,()=>controller?.settlement(room,game_id?{scope:'game',table_id,game_id}:{scope:'table',table_id})),
    act:(row,action)=>requireAccepted(controller,()=>controller?.settlement(room,{batch_id:row.batch_id!,transfer_id:row.transfer_id!,action}))};
  return <><RoomLedger key={room} roomId={room} session={session} transport={transport}/>
    {state.status==='pending'&&<Retry retry={()=>void controller?.recover()}/>}</>;
}
function Retry({retry}:{retry:()=>void}) {return <Pressable accessibilityRole="button" onPress={retry} style={{padding:12}}><Text>Check pending action</Text></Pressable>;}
export function DistributedPlatform({root,session}:{root:DistributedRootRuntime;session:Session}) {
  const {colors}=useTheme();
  const personal=usePlayerPhrases(session,true);
  const {controller,state,version}=useDistributedController(root,'platform');
  const [notifications,setNotifications]=useState<{id:string;kind:string;read:boolean}[]>([]);
  const [invitations,setInvitations]=useState<{id:string;room_id:string;room_name:string}[]>([]);
  const [inviteCursor,setInviteCursor]=useState<string|null>(null);
  const [tableInvitations,setTableInvitations]=useState<TableInvitation[]>([]),[tableCursor,setTableCursor]=useState<string|null>(null);
  const [error,setError]=useState('');
  const history=useMemo(()=>async(other:string,signal:AbortSignal):Promise<Message[]>=>{
    const lane=await root.reads.open(pair(session.user_id,other),signal);
    const [native,legacy]=await Promise.all([root.reads.history('social',lane.lane_id,signal),root.reads.legacy('direct',other,null,signal)]);
    // Legacy has no delivery sequence; it stays a separate page/source until display.
    return [...legacy.items,...native].map(row=>({id:row.id,sender_id:String(row.sender_id),recipient_id:String(row.recipient_id),text:String(row.text),sent_at:Date.parse(String(row.sent_at))}));
  },[root,session.user_id]);
  const transport:FriendsTransport={history,busy:!controller||state.busy,error:state.error,
    mutate:(other,action)=>requireAccepted(controller,()=>controller?.friendship(session.user_id,other,action)),
    send:(other,text)=>requireAccepted(controller,()=>controller?.chat(pair(session.user_id,other),text))};
  if(state.status==='accepted') {
    const sent=root.session.command('platform').request;
    if(sent?.body.command==='send-message')transport.sent={id:sent.body.command_id,text:String(sent.body.payload.text),
      recipient:'user-'+(sent.target.user_low===session.user_id.replace(/^user-/,'')?sent.target.user_high:sent.target.user_low)};
  }
  useEffect(()=>{
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function load(){
      try{
        const recipient=await root.reads.recipient(abort.signal);
        const [items,rooms,tables]=await Promise.all([root.reads.history('social',recipient.lane_id,abort.signal),root.reads.roomInvitations(null,abort.signal),root.reads.tableInvitations(null,abort.signal)]);
        if(!abort.signal.aborted){setNotifications(items.map(row=>({id:row.id,kind:String(row.kind),read:row.read===true})));setInvitations(rooms.items);setInviteCursor(rooms.next_id);setTableInvitations(tables.items);setTableCursor(tables.next_table_id);setError('');}
      }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not load notifications.');}
      finally{if(!abort.signal.aborted)timer=setTimeout(load,5000);}
    }
    void load();return()=>{abort.abort();clearTimeout(timer);};
  },[root,version]);
  const button=(label:string,run:()=>void)=><Pressable accessibilityRole="button" onPress={run} disabled={!controller||state.busy} style={{padding:12}}><Text style={{color:colors.accent}}>{label}</Text></Pressable>;
  return <View style={{gap:12}}>
    <DisplayNameField session={session}/>
    <PlayerPhrases userId={session.user_id} phrases={personal.phrases} connected={true} loadError={personal.error}
      onSave={personal.save} onRemove={personal.remove} onUpdate={personal.update}/>
    <FriendsPanel session={session} transport={transport}/>
    {state.status==='pending'&&<Retry retry={()=>void controller?.recover()}/>}
    <Text style={{color:colors.text}}>Notifications</Text>
    {notifications.map(row=><View key={row.id}><Text style={{color:colors.text}}>{row.kind.replaceAll('_',' ')}</Text>
      {!row.read&&button('Mark read',()=>void controller?.read({kind:'recipient',recipient_id:session.user_id.replace(/^user-/,'')},[row.id]))}</View>)}
    <Text style={{color:colors.text}}>Room invitations</Text>
    {invitations.map(row=><View key={row.id}><Text style={{color:colors.text}}>{row.room_name}</Text>
      {button('Accept invitation',()=>void controller?.room(row.room_id,'answer-room-invitation',{invitation_id:row.id,accept:true}))}
      {button('Decline invitation',()=>void controller?.room(row.room_id,'answer-room-invitation',{invitation_id:row.id,accept:false}))}</View>)}
    {inviteCursor&&button('More invitations',()=>{const abort=new AbortController();void root.reads.roomInvitations(inviteCursor,abort.signal).then(page=>{setInvitations(old=>[...old,...page.items.filter(item=>!old.some(r=>r.id===item.id))]);setInviteCursor(page.next_id);}).catch(e=>setError(String(e)));})}
    <Text style={{color:colors.text}}>Table invitations</Text>
    {tableInvitations.map(row=><View key={row.id}><Text style={{color:colors.text}}>{row.room_name} · {row.table_name}</Text>
      {button('Accept table invitation',()=>void controller?.table({...row,durable_game_id:null},'answer-table-invitation',{invitation_id:row.id,accept:true}))}
      {button('Decline table invitation',()=>void controller?.table({...row,durable_game_id:null},'answer-table-invitation',{invitation_id:row.id,accept:false}))}</View>)}
    {tableCursor&&button('More table invitations',()=>{const abort=new AbortController();void root.reads.tableInvitations(tableCursor,abort.signal).then(page=>{setTableInvitations(old=>[...old,...page.items.filter(item=>!old.some(r=>r.id===item.id))]);setTableCursor(page.next_table_id);}).catch(e=>setError(String(e)));})}
    {!!(error||state.error)&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{state.error||error}</Text>}
  </View>;
}
