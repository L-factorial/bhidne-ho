import { ChatComposer } from './ChatComposer';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, Animated, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { fonts, useTheme } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { TableSocialChannel, mergeTableMessages, type TableMessage } from '../multiplayer/TableSocialChannel';
import type { RoomPoke } from '../multiplayer/pokes';

type Effect = { id: string; player: number; kind: 'chat' | 'poke'; text: string; expires: number };
type SocialContext = {
  pokeMode: boolean; eligible: (id: number) => boolean; poke: (id: number) => void;
  effects: Effect[]; anchor: (node: View | null) => void; openChat: () => void; canRead: boolean;
};
const Context = createContext<SocialContext | null>(null);
export const useTableSocial = () => useContext(Context);

// All drawers report their actual top edge in the provider's coordinate space.
export function useSocialHandAnchor(existing?: RefObject<View | null>) {
  const local = useRef<View | null>(null), ref = existing || local;
  const social = useTableSocial();
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (ref.current) social?.anchor(ref.current); });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => () => social?.anchor(null), [social?.anchor]);
  return { ref, onLayout: () => { if (ref.current) social?.anchor(ref.current); } };
}

export function TableSocialProvider({ children, snapshot, channel, connected, userId, pokes }: {
  children: ReactNode; snapshot: RoomSnapshot; channel?: TableSocialChannel; connected: boolean; userId: string; pokes: RoomPoke[];
}) {
  const { colors: c } = useTheme();
  const { height: viewportHeight, width } = useWindowDimensions();
  const root = useRef<View>(null), anchorNode = useRef<View | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [bottom, setBottom] = useState(16);
  const [open, setOpen] = useState(false), [pokeMode, setPokeMode] = useState(false);
  const [messages, setMessages] = useState<TableMessage[]>([]), [unread, setUnread] = useState(0);
  const [effects, setEffects] = useState<Effect[]>([]), [draft, setDraft] = useState('');
  const [error, setError] = useState(''), [sending, setSending] = useState(false);
  const sendingRef = useRef(false), pokePending = useRef(false);
  const [pokeSent, setPokeSent] = useState(false);
  const openRef = useRef(open); openRef.current = open;
  const historyLoaded = useRef(false);
  const seen = useRef(new Set<string>()), seenPokes = useRef(new Set<string>());
  const scroll = useRef<ScrollView>(null), follow = useRef(true);
  const lifetime = useRef(new AbortController());
  const seated = snapshot.table ? !!snapshot.table.current_user.is_seated : !!snapshot.your_player_id;
  const canRead = snapshot.status !== 'ended' && (seated || !!snapshot.table?.current_user.is_queued);
  const enabled = seated && connected && canRead;
  const myTurn = snapshot.game?.turn.player_id === snapshot.your_player_id && !!snapshot.your_player_id;
  const players = snapshot.players || [];
  const eligible = (id: number) => enabled && id !== snapshot.your_player_id && players.some(p => p.player_id === id && p.connected !== false)
    && (!snapshot.table || snapshot.table.seated_players.some(p => p.seat_id === id));
  const measure = useRef((node: View | null) => {});
  measure.current = node => {
    if (!node) { setBottom(16); return; }
    root.current?.measureInWindow((_x, y, _w, height) => node.measureInWindow((_ax, ay) => {
      const next = Math.max(16, height - (ay-y) + 12);
      setBottom(current => Math.abs(current-next) < 1 ? current : next);
    }));
  };
  const [anchor] = useState(() => (node: View | null) => { anchorNode.current = node; measure.current(node); });
  useEffect(() => { measure.current(anchorNode.current); }, [viewportHeight, width]);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!pokeSent) return;
    const timer = setTimeout(() => setPokeSent(false), 1800);
    return () => clearTimeout(timer);
  }, [pokeSent]);
  useEffect(() => { if (!connected || !canRead) { setPokeMode(false); setOpen(false); } if (!canRead) { setMessages([]); setUnread(0); setEffects([]); } }, [connected, canRead]);
  useEffect(() => {
    if (!pokeMode) return;
    const timer = setTimeout(() => setPokeMode(false), 15000);
    return () => clearTimeout(timer);
  }, [pokeMode]);
  useEffect(() => {
    if (Platform.OS !== 'web' || (!open && !pokeMode)) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); setPokeMode(false);
    };
    // Consume the same keyup used by the enclosing game modal.
    globalThis.addEventListener('keyup', escape, true);
    return () => globalThis.removeEventListener('keyup', escape, true);
  }, [open, pokeMode]);
  const addMessages = (incoming: TableMessage[], historical = false) => {
    const valid = incoming.filter(m => m.match_id === snapshot.match_id && m.room_id === snapshot.room_id);
    const fresh = valid.filter(m => !seen.current.has(m.id));
    valid.forEach(m => seen.current.add(m.id));
    if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200));
    setMessages(current => mergeTableMessages(current, valid));
    if (!historical) {
      const received = fresh.filter(m => m.sender_id !== userId);
      if (!openRef.current) setUnread(n => n+received.length);
      setEffects(current => [...current, ...received.filter(m => Date.now()-m.sent_at < 5000).map(m => ({id:m.id,player:players.find(p => p.user_id === m.sender_id)?.player_id ?? -1,kind:'chat' as const,text:m.text,expires:Date.now()+3500}))].slice(-6));
    }
  };
  useEffect(() => {
    if (!channel || !canRead || !connected || !snapshot.match_id) return;
    const controller = new AbortController();
    const unsubscribe = channel.subscribe(value => {
      const message = value as TableMessage;
      if (message?.type === 'TABLE_CHAT_MESSAGE') addMessages([message]);
    });
    void channel.request('TABLE_CHAT_HISTORY', snapshot.match_id, {}, controller.signal).then(result => {
      if (!controller.signal.aborted) { addMessages(result.messages || [], !historyLoaded.current); historyLoaded.current = true; }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); unsubscribe(); };
  }, [channel, canRead, connected, snapshot.match_id]);
  useEffect(() => {
    const fresh = pokes.filter(p => p.match_id === snapshot.match_id && p.expires_at > Date.now() && !seenPokes.current.has(p.id));
    fresh.forEach(p => seenPokes.current.add(p.id));
    if (seenPokes.current.size > 100) seenPokes.current = new Set([...seenPokes.current].slice(-50));
    if (fresh.length) setEffects(current => [...current, ...fresh.map(p => ({ id:p.id, player:players.find(row => row.user_id === (p.recipient_id ?? p.sender_id))?.player_id ?? -1, kind:'poke' as const, text:p.text, expires:Math.min(p.expires_at,Date.now()+3500) }))].slice(-6));
  }, [pokes, snapshot.match_id]);
  useEffect(() => {
    if (!effects.length) return;
    const timer = setTimeout(() => setEffects(current => current.filter(e => e.expires > Date.now())), Math.max(1, Math.min(...effects.map(e => e.expires))-Date.now()));
    return () => clearTimeout(timer);
  }, [effects]);
  function closeChat() { Keyboard.dismiss(); setOpen(false); }
  // Also dismiss when permissions/connectivity close chat, or the table unmounts.
  useEffect(() => {
    if (!open) return;
    return () => { Keyboard.dismiss(); };
  }, [open]);
  function measureRoot() {
    measure.current(anchorNode.current);
    root.current?.measureInWindow((_x, y) => setKeyboardOffset(y));
  }
  function openChat() { if (canRead) { setPokeMode(false); openRef.current = true; setOpen(true); setUnread(0); follow.current = true; } }
  async function poke(id: number) {
    setPokeMode(false);
    if (!eligible(id) || !channel || !snapshot.match_id || pokePending.current) return;
    pokePending.current = true;
    setError('');
    try { await channel.request('TABLE_POKE_SEND', snapshot.match_id, {recipient_player_id:id,text:'👋'}, lifetime.current.signal); if (!lifetime.current.signal.aborted) setPokeSent(true); }
    catch (failure) { if (!lifetime.current.signal.aborted) setError((failure as Error).message); }
    finally { pokePending.current = false; }
  }
  async function send() {
    if (sendingRef.current || !enabled || !draft.trim() || Array.from(draft).length > 500 || !channel || !snapshot.match_id) return;
    const submitted = draft;
    sendingRef.current = true; setSending(true); setError('');
    try {
      const result = await channel.request('TABLE_CHAT_SEND', snapshot.match_id, {text:submitted}, lifetime.current.signal);
      if (!lifetime.current.signal.aborted) { if (result.message) addMessages([result.message]); setDraft(current => current === submitted ? '' : current); }
    } catch (failure) { if (!lifetime.current.signal.aborted) setError((failure as Error).message); }
    finally { sendingRef.current = false; if (!lifetime.current.signal.aborted) setSending(false); }
  }
  const iconStyle = { minWidth:44, minHeight:44, alignItems:'center' as const, justifyContent:'center' as const };
  return <Context.Provider value={{pokeMode,eligible,poke,effects,anchor,openChat,canRead}}>
    <View ref={root} collapsable={false} style={{flex:1,minHeight:0,minWidth:0,width:'100%'}} onLayout={measureRoot} onTouchStart={() => { if(pokeMode) setPokeMode(false); }} onPointerDown={() => { if(pokeMode) setPokeMode(false); }}>
      {children}
      {canRead && <View testID="game-social-controls" onTouchStart={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} style={{position:'absolute',right:14,bottom,zIndex:45,alignItems:'flex-end',maxWidth:240}}>
        {pokeMode && <Text accessibilityLiveRegion="polite" style={{color:c.text,backgroundColor:c.surface,padding:6,borderRadius:8}}>Poke someone · tap an opponent</Text>}
        {!!error && !open && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss social error" onPress={() => setError('')}><Text style={{color:c.danger,backgroundColor:c.surface,padding:6}}>{error}</Text></Pressable>}
        <View style={{flexDirection:'row',backgroundColor:c.surface,borderColor:c.border,borderWidth:1,borderRadius:24}}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Table Chat${unread ? `, ${unread} unread` : ''}`} onPress={openChat} style={[iconStyle,{flexDirection:'row',paddingHorizontal:8}]}>
            <Text style={{color:c.text,fontSize:20}}>💬</Text>{unread > 0 && <Text testID="table-chat-unread" style={{color:c.text,fontSize:11,paddingHorizontal:3}}>{unread > 99 ? '99+' : unread}</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Poke a player" accessibilityState={{selected:pokeMode,disabled:!enabled}} disabled={!enabled} onPress={() => { closeChat(); setPokeMode(value => !value); }} style={[iconStyle,{opacity:enabled?1:0.4,backgroundColor:pokeMode?c.surfaceSelected:undefined,borderRadius:24}]}><Text accessibilityLiveRegion="polite" accessibilityLabel={pokeSent ? 'Poke sent' : undefined} style={{fontSize:20}}>{pokeSent ? '✓' : '👋'}</Text></Pressable>
        </View>
      </View>}
      {/* The game shell owns safe-area padding. Measure its screen offset instead of adding it twice.
          Android's enclosing Modal uses adjustResize; only iOS needs keyboard padding here. */}
      {open && canRead && <KeyboardAvoidingView pointerEvents="box-none" enabled={Platform.OS === 'ios'} behavior="padding" keyboardVerticalOffset={keyboardOffset}
        style={{position:'absolute',top:0,bottom:0,right:0,left:0,zIndex:60}}>
        <View pointerEvents="box-none" style={{flex:1,minHeight:0,justifyContent:'flex-end',alignItems:'flex-end',paddingHorizontal:8}}>
        <View testID="table-chat-panel" style={{width:width<900?'100%':360,height:Math.min(380,viewportHeight*0.5),maxHeight:'85%',minHeight:0,backgroundColor:c.surface,borderRadius:20,padding:12,gap:8}}>
          <View style={{flexDirection:'row',alignItems:'center',flexShrink:0,borderBottomWidth:1,borderColor:c.border,paddingBottom:4}}><Text accessibilityRole="header" style={{flex:1,color:c.text,fontFamily:fonts.medium,fontSize:20}}>Table Chat</Text><Pressable accessibilityRole="button" accessibilityLabel="Close table chat" onPress={closeChat} style={iconStyle}><Text style={{color:c.text,fontSize:24}}>×</Text></Pressable></View>
          {myTurn && <Pressable accessibilityRole="button" onPress={closeChat} style={{minHeight:44,justifyContent:'center'}}><Text accessibilityLiveRegion="polite" style={{color:c.accent}}>Your turn · Return to game</Text></Pressable>}
          <ScrollView ref={scroll} testID="table-chat-messages" style={{flex:1,minHeight:0}} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" onLayout={() => { if(follow.current) scroll.current?.scrollToEnd({animated:false}); }} onScroll={({nativeEvent:e}) => { follow.current = e.contentSize.height-e.contentOffset.y-e.layoutMeasurement.height < 40; }} scrollEventThrottle={16} onContentSizeChange={() => { if(follow.current) scroll.current?.scrollToEnd({animated:false}); }}>
            {!messages.length && <Text style={{color:c.textMuted}}>Start the table conversation.</Text>}
            {messages.map(message => <View key={message.id} style={{paddingVertical:12,gap:6}}>
              <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                <View style={{width:28,height:28,borderRadius:14,backgroundColor:c.surfaceRaised,alignItems:'center',justifyContent:'center'}}>
                  <Text style={{color:c.accent,fontFamily:fonts.medium,fontSize:11}}>{message.sender_name.slice(0,1).toUpperCase()}</Text>
                </View>
                <Text style={{flex:1,color:c.accent,fontFamily:fonts.medium,fontSize:11}}>{message.sender_name}{message.sender_id === userId ? ' (You)' : ''}</Text>
                <Text style={{color:c.textMuted,fontFamily:fonts.body,fontSize:11}}>{new Date(message.sent_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</Text>
              </View>
              <Text selectable style={{marginLeft:36,color:c.text,fontFamily:fonts.body,fontSize:13,lineHeight:20}}>{message.text}</Text>
            </View>)}
          </ScrollView>
          {!!error && <Text accessibilityRole="alert" style={{color:c.danger}}>{error}</Text>}
          {!connected && <Text style={{color:c.textMuted}}>Reconnecting…</Text>}
          {seated ? <View testID="table-chat-composer" style={{flexShrink:0}}>
            <ChatComposer value={draft} onChange={setDraft} onSend={() => void send()} disabled={!enabled || sending}
              label="Table message" sendLabel="Send table message" placeholder="Write a message…" />
          </View> : <Text style={{color:c.textMuted}}>Waiting players can read. Take a seat to chat.</Text>}
        </View>
        </View>
      </KeyboardAvoidingView>}
    </View>
  </Context.Provider>;
}

export function PlayerSocialEffect({ playerId }: { playerId?: number }) {
  const social = useTableSocial(), { colors:c } = useTheme();
  const effect = social?.effects.filter(e => e.player === playerId).at(-1);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!effect) return;
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!live || reduced) return;
      fade.setValue(0.4); Animated.timing(fade,{toValue:1,duration:180,useNativeDriver:true}).start();
    });
    return () => { live=false; fade.stopAnimation(); fade.setValue(1); };
  }, [effect?.id]);
  if (!effect) return null;
  return <Animated.View testID={`seat-social-${playerId}`} pointerEvents="none" accessibilityLiveRegion="polite" style={{position:'absolute',bottom:'100%',marginBottom:4,maxWidth:110,minWidth:44,padding:5,borderRadius:10,backgroundColor:c.surface,borderColor:c.border,borderWidth:1,opacity:fade,zIndex:20}}>
    <Text numberOfLines={2} style={{color:c.text,fontSize:effect.kind==='poke'&&effect.text==='👋'?22:11,textAlign:'center'}}>{effect.text}</Text>
  </Animated.View>;
}
