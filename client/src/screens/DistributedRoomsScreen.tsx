import { AuthMethodChoices } from '../components/AuthMethodChoices';
import { BlockedPlayers } from '../components/PlayerBlocking';
import { DeleteAccountLink } from './DeletionScreen';
import { setSessionNotice } from '../auth/sessionNotice';
import { AccountPage, accountStyles } from '../components/AccountPage';
import { AppHeader } from '../components/AppHeader';
import { FormInput } from '../components/FormInput';
import { ForgotPassword, RecoveryEmailSettings } from './RecoveryScreen';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { validSignupEmail } from '../auth/email';
import { ui, uiLabel } from '../i18n/copy.ts';
import { playerError } from '../multiplayer/playerError.ts';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { apiUrl, request } from '../multiplayer/api';
import { readSession, saveSession, signOutSession, isCurrentSession, type Session } from '../multiplayer/session';
import { acquireJournal } from '../multiplayer/journalPlatform';
import { OwnedSession } from '../multiplayer/JournalOwner';
import { distributedIdentity } from '../multiplayer/distributedIdentity';
import { DistributedRootRuntime, type RootView } from '../multiplayer/DistributedRoot';
import type { DistributedScreenController, ScreenActionState } from '../multiplayer/DistributedScreenController';
import type { SelectedTable } from '../multiplayer/DistributedControls';
import type { CatalogRoom } from '../multiplayer/DistributedReadClient';
import type { Json } from '../multiplayer/DurableCommandClient';
import { useTheme } from '../theme';
import { LiveGameTable, type RoomSnapshot } from './LiveGameTable';
import { MarriageTable } from './MarriageTable';
import { FlushTable } from './FlushTable';
import { TableControls } from '../components/TableControls';
import { RuleProposal } from '../components/RuleProposal';
import { DistributedLedger, DistributedPlatform } from '../components/DistributedPlatform';
import { DistributedChat } from '../components/DistributedChat';
import { DistributedRoomSettings } from '../components/DistributedRoomSettings';
import { DistributedInvitees } from '../components/DistributedInvitees';
import { PokeOverlay } from '../components/PokeOverlay';
import { readPoke, appendPoke, type RoomPoke } from '../multiplayer/pokes';
import { usePlayerPhrases } from '../multiplayer/usePlayerPhrases';
import { requireAccepted } from '../multiplayer/useDistributedController';

type Snapshot = RoomSnapshot & SelectedTable;
type Projection = {room_id:string;name:string;creator_id:string;tables:{table_id:string;name:string;game_type:string}[];snapshot:Snapshot|null};
const idle: ScreenActionState = {status:'idle',busy:false,commandId:null,error:'',receipt:null};
const payload = (value: object = {}) => value as {[key:string]:Json};

// Mounted only by the explicit integration build. No legacy room socket, command
// client or process-local read route is constructed by this screen.
export function DistributedRoomsScreen() {
  useUiLanguage();
  const {colors} = useTheme();
  const authStyles = accountStyles(colors);
  const [account,setAccount] = useState<Session|null>(()=>readSession(apiUrl)?.session??null);
  const [username,setUsername] = useState(''), [password,setPassword] = useState('');
  const [email,setEmail] = useState('');
  const [accountFormOpen,setAccountFormOpen] = useState(false);
  const [signupMode,setSignupMode] = useState(false), [confirmPassword,setConfirmPassword] = useState('');
  const [authBusy,setAuthBusy] = useState(false), [error,setError] = useState('');
  const [runtime,setRuntime] = useState<DistributedRootRuntime|null>(null);
  const [action,setAction] = useState(idle), [chatAction,setChatAction] = useState(idle);
  const [rooms,setRooms] = useState<CatalogRoom[]>([]), [cursor,setCursor] = useState<string|null>(null);
  const [selected,setSelected] = useState<{room:string;table:string|null}|null>(null);
  const [projection,setProjection] = useState<Projection|null>(null);
  const [members,setMembers] = useState<string[]>([]), [messages,setMessages] = useState<Record<string,unknown[]>>({});
  const [name,setName] = useState(''), [text,setText] = useState('');
  const [kind,setKind] = useState<'callbreak'|'marriage'|'flush'>('callbreak'), [capacity,setCapacity] = useState('4');
  const [refresh,setRefresh] = useState(0);
  const [platformOpen,setPlatformOpen] = useState(false), [ledgerOpen,setLedgerOpen] = useState(false);
  const [visibility,setVisibility] = useState<'public'|'private'>('public');
  const [chatOpen,setChatOpen] = useState(false);
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [inviteOpen,setInviteOpen] = useState(false),[invitees,setInvitees] = useState<string[]>([]);
  const [pokes,setPokes] = useState<RoomPoke[]>([]);
  const personal=usePlayerPhrases(account,!!account);
  const pokeController = useRef<DistributedScreenController|null>(null);
  const controller = useRef<DistributedScreenController|null>(null), chat = useRef<DistributedScreenController|null>(null);
  const selectionRef = useRef(selected); selectionRef.current=selected;
  const fail = (e: unknown) => {
    if (!isCurrentSession(apiUrl, account)) return;
    if ((e as {status?:number})?.status === 401) {
      saveSession(apiUrl,null);setSelected(null);setAccount(null);setProjection(null);
      setSessionNotice(apiUrl,'auth','session_ended');return;
    }
    setError(playerError(e, 'Request failed.'));
  };

  useEffect(()=>{
    setRooms([]);setCursor(null);setText('');setName('');setPlatformOpen(false);setLedgerOpen(false);setChatOpen(false);setSettingsOpen(false);setInviteOpen(false);setInvitees([]);
    if (!account) return;
    let active=true;
    const snapshotLanes=new Set<string>();
    const owned=new OwnedSession<DistributedRootRuntime>(acquireJournal);
    setError('');setAction(idle);setChatAction(idle);
    void Promise.resolve().then(()=>owned.select(distributedIdentity(apiUrl,account.user_id), owner=>new DistributedRootRuntime(owner,apiUrl+'/distributed',account.token,{
      install(lane,view: RootView) {
        if (!active) return;
        if (view.kind==='snapshot') {snapshotLanes.add(lane);setProjection(view.value as Projection);}
        else if (view.kind==='chat') setMessages(old=>({...old,[lane]:view.value as unknown[]}));
      },
      remove(lane) { if (active) {
        if(snapshotLanes.delete(lane))setProjection(null);
        setMessages(old=>{const next={...old};delete next[lane];return next;});
      } },
      error(_lane,e) { if (active) {
        fail(e);
      } },
      transient(value) {
        const selection=selectionRef.current;
        if(!active||!selection)return;
        const poke=readPoke(value,selection.room,account.user_id);
        if(poke)setPokes(old=>appendPoke(old,poke));
      },
    }))).then(root=>{
      if (!root || !active) return;
      controller.current=root.screen('screen',{changed:setAction,accepted:()=>setRefresh(n=>n+1)});
      chat.current=root.screen('chat',{changed:setChatAction,accepted:()=>setText('')});
      pokeController.current=root.screen('pokes',{changed:()=>{},accepted:()=>{}});
      setRuntime(root);
    }).catch(e=>{if(active)fail(e);});
    return ()=>{
      active=false;controller.current?.dispose();controller.current=null;chat.current?.dispose();chat.current=null;
      pokeController.current?.dispose();pokeController.current=null;
      owned.close();setRuntime(null);setProjection(null);setMessages({});setMembers([]);setPokes([]);
    };
  },[account]);

  useEffect(()=>{
    if (!runtime) return;
    setProjection(null);setMessages({});setMembers([]);setPokes([]);
    void runtime.select(selected?{...selected,chat:['room_chat']}:null).catch(fail);
  },[runtime,selected]);

  useEffect(()=>{
    if (!runtime) return;
    let active=true;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function load() {
      try {
        if (selected) {
          const [view,page]=await Promise.all([runtime!.reads.room<Projection>(selected.room,selected.table,abort.signal),runtime!.reads.members(selected.room,null,abort.signal)]);
          // Selected game projections come only from the root's serialized reads;
          // an independent refresh must not overwrite a newer game revision.
          if(active && isCurrentSession(apiUrl, account)) {if(!selected.table)setProjection(view);setMembers(page.items);}
        } else {
          const page=await runtime!.reads.catalog(null,abort.signal);
          if(active && isCurrentSession(apiUrl, account)){setRooms(page.items);setCursor(page.next_room_id);}
        }
      } catch(e) {if(active)fail(e);}
      finally {if(active)timer=setTimeout(load,5000);}
    }
    void load();return ()=>{active=false;abort.abort();clearTimeout(timer);};
  },[runtime,selected,refresh]);

  const button=(label:string,run:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    onPress={run} style={{padding:12,minHeight:44,borderRadius:8,backgroundColor:colors.surface,opacity:disabled?0.45:1}}><Text style={{color:colors.text}}>{label}</Text></Pressable>;
  const input=(label:string,value:string,change:(s:string)=>void,secure=false)=><TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.textMuted}
    value={value} onChangeText={change} secureTextEntry={secure} autoCapitalize="none" style={{color:colors.text,borderColor:colors.textMuted,borderWidth:1,padding:12,borderRadius:8}}/>;
  async function login(signup: boolean) {
    if (authBusy || (signup && (!confirmPassword || password !== confirmPassword || !validSignupEmail(email)))) return;
    setAuthBusy(true);setError('');
    try {const session=await request<Session>(signup?'/auth/signup':'/auth/signin',null,{username,password,...(signup?{email:email.trim()}:{})});saveSession(apiUrl,{session,room:null,game:null});setSessionNotice(apiUrl,'auth');setPassword('');setConfirmPassword('');setEmail('');setAccount(session);}
    catch(e){setError(playerError(e && typeof e === 'object' && 'status' in e && e.status === 401 ? Error(ui("common.invalid_credentials")) : e));}finally{setAuthBusy(false);}
  }
  async function logout() {
    const pending = signOutSession(apiUrl, account, value => request('/auth/signout', value, {}));
    runtime?.close();
    setSelected(null);setAccount(null);setProjection(null);setMessages({});setMembers([]);setPokes([]);setText('');setError('');
    await pending;
  }
  if (!account) return <AccountPage compact footer={accountFormOpen ? <>
    {!signupMode && <DeleteAccountLink />}
    <Pressable accessibilityRole="button" disabled={authBusy || (signupMode && (!confirmPassword || password !== confirmPassword || !validSignupEmail(email)))}
      onPress={() => void login(signupMode)} style={[authStyles.button,{backgroundColor:colors.primary},authBusy && {opacity:.5}]}>
      <Text style={[authStyles.buttonText,{color:colors.onPrimary}]}>{ui(signupMode ? 'common.create_account' : 'common.sign_in')}</Text>
    </Pressable>
  </> : null}>
    <Text accessibilityRole="header" style={authStyles.title}>{ui(signupMode ? 'common.create_your_account' : 'common.welcome_back')}</Text>
    {button(ui(signupMode ? 'common.sign_in' : 'common.sign_up'),()=>{setSignupMode(!signupMode);setAccountFormOpen(false);setConfirmPassword('');setError('');},authBusy)}
    {!accountFormOpen ? <AuthMethodChoices signup={signupMode} disabled={authBusy} onContinue={() => setAccountFormOpen(true)} /> : <>
    <FormInput accessibilityLabel={ui('common.username')} placeholder={ui('common.username')} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} editable={!authBusy} style={authStyles.input} />
    {signupMode && <>
      <FormInput accessibilityLabel={ui('common.email')} aria-required placeholder={ui('common.email')} value={email}
        onChangeText={setEmail} maxLength={254} keyboardType="email-address" textContentType="emailAddress"
        editable={!authBusy} autoCapitalize="none" autoCorrect={false} style={authStyles.input} />
      <Text style={authStyles.description}>{ui('common.signup_email_help')}</Text>
      {!!email && !validSignupEmail(email) && <Text accessibilityRole="alert" style={{color:colors.danger}}>{ui('common.enter_valid_email')}</Text>}
    </>}
    <FormInput accessibilityLabel={ui('common.password')} placeholder={ui('common.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!authBusy} style={authStyles.input} />
    {!signupMode && <ForgotPassword />}
    {signupMode && <FormInput accessibilityLabel={ui('common.confirm_password')} placeholder={ui('common.confirm_password')} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!authBusy} style={authStyles.input} />}
    {signupMode && !!confirmPassword && password !== confirmPassword && <Text accessibilityRole="alert" style={{color:colors.danger}}>{ui('common.passwords_do_not_match')}</Text>}
    {!!error&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{uiLabel(error, 'feedback')}</Text>}
    </>}
  </AccountPage>;

  const snapshot=projection?.snapshot;
  const busy=action.busy||!runtime;
  const table=(command:string,data:object={})=>snapshot&&controller.current?.table({...snapshot,room_id:projection!.room_id},command,payload(data));
  const game=(command:string,data:object={})=>snapshot&&controller.current?.game({...snapshot,room_id:projection!.room_id},command,payload(data));
  const start=(data:object={play_mode:'manual'})=>{void table('start',data);};
  const back=()=>setSelected(selected?{room:selected.room,table:null}:null);
  const sendPoke=async(recipient_player_id:number|null,text:string)=>{
    if(!snapshot||!selected)throw Error(ui("common.select_table_first"));
    await requireAccepted(pokeController.current,()=>pokeController.current?.table({...snapshot,room_id:selected.room},'send-poke',{text,recipient_player_id}));
  };
  const social={connected:!!runtime,phrases:personal.phrases,save:personal.save,send:sendPoke};
  const controls=snapshot?.table&&<>
    <TableControls table={snapshot.table} members={members} userId={account.user_id} busy={busy}
      act={async(command,data)=>{await table(command,data);}} start={async()=>{await table('start',snapshot.game_type==='flush'?{rules_revision:snapshot.flush_settings?.rules_revision}:{play_mode:'manual'});}}/>
    {snapshot.rule_proposal&&<RuleProposal proposal={snapshot.rule_proposal} busy={busy} userId={account.user_id}
      vote={accept=>void table('rule-vote',{proposal_id:snapshot.rule_proposal!.id,accept})}/>}
    {snapshot.table.current_user.can_join&&button(ui("rooms.take_seat"),()=>void table('join-seat'),busy)}
  </>;
  const endControl=button(ui("rooms.end_table"),()=>void table('end'),busy);
  if(snapshot&&selected?.table) {
    const common={snapshot,busy,error:action.error||error,onBack:back,onNewGame:back,endControl,tableControl:controls,
      onAction:(command:string,data?:object)=>{void game(command,data);}};
    return <View style={{flex:1}}>
      {action.status==='pending'&&button(ui("common.pending_action"),()=>void controller.current?.recover())}
      {button(chatOpen?ui("common.close_chat"):ui("social.chat"),()=>setChatOpen(v=>!v))}
      {chatOpen&&runtime&&<DistributedChat root={runtime} view={{...snapshot,room_id:selected.room}}/>}
      {snapshot.game_type==='flush'?<FlushTable {...common} social={{...social,send:text=>sendPoke(null,text)}} connectionReady={!!runtime}
        onSave={data=>void table('flush-settings',data)} onStart={rules_revision=>start({rules_revision})} onLock={()=>void table('lock')}/>
      :snapshot.game_type==='marriage'?<MarriageTable {...common} social={social} onSave={scoring=>void table('marriage-settings',{scoring})}
        onStart={()=>start()} onTableAction={command=>void table(command)}/>
      :<LiveGameTable {...common} social={social} onSave={settings=>void table('settings',settings)} onStart={()=>start()}
        onNextDeal={()=>void game('NEXT_DEAL',{deal_number:snapshot.round_review?.deal_number})} onTableAction={command=>void table(command)}/>}
      <PokeOverlay pokes={pokes} matchId={snapshot.match_id}/>
    </View>;
  }
  return <ScrollView style={{backgroundColor:colors.background}} contentContainerStyle={{padding:20,gap:12}}>
    <AppHeader hideProfile />
    <RecoveryEmailSettings session={account} /><BlockedPlayers session={account} /><DeleteAccountLink />
    <Text accessibilityRole="header" style={{color:colors.text,fontSize:24}}>{projection?.name||ui("rooms.your_rooms")}</Text>
    {!!(error||action.error)&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{uiLabel(action.error||error, 'feedback')}</Text>}
    {action.status==='pending'&&button(ui("common.pending_action"),()=>void controller.current?.recover())}
    {button(ui("common.sign_out_label"),()=>void logout(),authBusy)}
    {button(platformOpen?ui("common.close_profile_friends"):ui("common.profile_friends"),()=>setPlatformOpen(v=>!v))}
    {platformOpen&&runtime&&<DistributedPlatform root={runtime} session={account}/>}
    {button(inviteOpen?ui("common.close_invitation_choices"):'Invite players',()=>setInviteOpen(v=>!v))}
    {inviteOpen&&<DistributedInvitees session={account} selected={invitees} change={setInvitees}/>}
    {selected?<>
      {button('All rooms',()=>setSelected(null))}
      {projection?.creator_id===account.user_id&&button(settingsOpen?ui("common.close_room_settings"):ui("common.room_settings"),()=>setSettingsOpen(v=>!v))}
      {settingsOpen&&runtime&&projection?.creator_id===account.user_id&&<DistributedRoomSettings key={selected.room} root={runtime} room={selected.room} session={account}/>}
      {button(ledgerOpen?ui("common.close_ledger"):ui("ledger.ledger"),()=>setLedgerOpen(v=>!v))}
      {ledgerOpen&&runtime&&<DistributedLedger key={selected.room} root={runtime} room={selected.room} session={account}/>}
      {(projection?.tables??[]).map(t=><View key={t.table_id}>{button(t.name+' · '+t.game_type,()=>setSelected({room:selected.room,table:t.table_id}))}</View>)}
      {input(ui("rooms.table_name"),name,setName)}
      <View style={{flexDirection:'row',gap:8}}>{(['callbreak','marriage','flush'] as const).map(k=><View key={k}>{button(k+(kind===k?' ✓':''),()=>setKind(k))}</View>)}</View>
      {input('Players',capacity,setCapacity)}
      {button(ui("rooms.create_table"),()=>void controller.current?.room(selected.room,'create-table',{game_type:kind,capacity:Number(capacity),name:name||'Table',invitees}),busy)}
      {button(ui("rooms.leave_room"),()=>void controller.current?.room(selected.room,'leave-room').then(ok=>{if(ok&&controller.current?.state.status==='accepted')setSelected(null);}),busy)}
      <Text style={{color:colors.text}}>{ui("rooms.room_chat")}</Text>
      {Object.entries(messages).flatMap(([lane,items])=>items.map((item,index)=>{const row=item as {text?:string;sender_id?:string};return <Text key={lane+index} style={{color:colors.text}}>{row.sender_id}: {row.text}</Text>;}))}
      {input(ui("social.message"),text,setText)}
      {button('Send message',()=>void chat.current?.chat({kind:'room_chat',room_id:selected.room},text),!text.trim()||chatAction.busy||!runtime)}
      {!!chatAction.error&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{uiLabel(chatAction.error, 'feedback')}</Text>}
    </>:<>
      {input(ui("rooms.room_name"),name,setName)}
      {button(visibility==='public'?'Public room':'Private room',()=>setVisibility(v=>v==='public'?'private':'public'))}
      {button(ui("rooms.create_room"),()=>void controller.current?.createRoom(name,visibility,invitees),busy||!name.trim())}
      {rooms.map(r=><View key={r.room_id}>{button(r.name+(r.is_member?'':' · Join'),()=>{
        if(r.is_member)setSelected({room:r.room_id,table:null});
        else void controller.current?.room(r.room_id,'enter-room').then(ok=>{if(ok&&controller.current?.state.status==='accepted')setSelected({room:r.room_id,table:null});});
      },busy)}</View>)}
      {cursor&&button('More rooms',()=>{const abort=new AbortController();void runtime?.reads.catalog(cursor,abort.signal).then(page=>{if(!selectionRef.current){setRooms(old=>[...old,...page.items.filter(item=>!old.some(r=>r.room_id===item.room_id))]);setCursor(page.next_room_id);}}).catch(fail);})}
    </>}
  </ScrollView>;
}
