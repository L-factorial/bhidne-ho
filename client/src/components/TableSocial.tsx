import { preserveRemovals } from './moderation/messages';
import { CommunityRulesEntry } from './moderation/CommunityRules';
import { ReportButton } from './Moderation';
import type { Session } from '../multiplayer/session';
import { useBlocking } from './PlayerBlocking';
import { usePersistentNotice } from '../multiplayer/usePersistentNotice';
import { playerError } from '../multiplayer/playerError.ts';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Ionicons } from '@expo/vector-icons';
import { TableReactionFlight, type ReactionFlight } from './TableReactionFlight';
import { readTableReaction, tableReactions, PUNCHLINE_LIMIT, type ReactionId } from '../multiplayer/tableReactions';
import type { PlayerPhrase } from '../multiplayer/pokes';
import { FormFooter } from './FormFooter';
import { PlayerAvatar } from './PlayerAvatar';
import { RoomSheet } from './RoomSheet';
import { GameModalContent } from './GameModal';
import { ChatMessage } from './ChatMessage';
import { useTranslation } from 'react-i18next';
import { ChatComposer } from './ChatComposer';
import { ChatInputDiagnostics } from './ChatInputDiagnostics';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, Animated, Keyboard, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { fonts, useTheme, type ThemeColors } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { TableSocialChannel, mergeTableMessages, type TableMessage } from '../multiplayer/TableSocialChannel';
import type { RoomPoke } from '../multiplayer/pokes';

type Effect = { id: string; player: number; kind: 'chat' | 'poke'; text: string; expires: number };
type SocialContext = {
  pokeMode: boolean; eligible: (id: number) => boolean; poke: (id: number) => void;
  effects: Effect[]; anchor: (node: View | null) => void; openChat: () => void; canRead: boolean; chatOpen: boolean;
  registerSeat: (id: number, node: View | null) => void; overlayOpen: boolean;
  presentation: (children: ReactNode, expanded: boolean) => ReactNode;
  openPoke: () => void; unread: number; enabled: boolean; pokeSent: boolean;
  setHandCollapsed: (collapsed: boolean) => void;
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

export function TableSocialProvider({ children, snapshot, channel, connected, userId, session, pokes, phrases = [], expanded = true, colors }: {
  expanded?: boolean; colors?: ThemeColors; session: Session; children: ReactNode; snapshot: RoomSnapshot; channel?: TableSocialChannel; connected: boolean; userId: string; pokes: RoomPoke[]; phrases?: PlayerPhrase[];
}) {
  const uiLanguage = useUiLanguage();
  const blocking = useBlocking(session);
  const reconnecting = usePersistentNotice(!connected);
  const theme = useTheme();
  const c = colors || theme.colors;
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const { height: viewportHeight, width } = useWindowDimensions();
  const root = useRef<View>(null), anchorNode = useRef<View | null>(null);
  const seats = useRef(new Map<number, View>());
  const [registerSeat] = useState(() => (id: number, node: View | null) => { if (node) seats.current.set(id, node); else seats.current.delete(id); });
  const [targetPlayer, setTargetPlayer] = useState<number | null>(null);
  const [sendingPoke, setSendingPoke] = useState(false);
  const [punchline, setPunchline] = useState('');
  const [flights, setFlights] = useState<ReactionFlight[]>([]);
  const reactionIds = useRef(new Set<string>());
  const { t } = useTranslation();
  const [bottom, setBottom] = useState(16);
  const [handCollapsed,setHandCollapsed]=useState(false);
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
  // Room-feed presence can lag the live socket. The server validates delivery.
  const eligible = (id: number) => enabled && id !== snapshot.your_player_id && players.some(p => p.player_id === id)
    && (!snapshot.table || snapshot.table.seated_players.some(p => p.seat_id === id));
  useEffect(() => { if (!enabled) { setPokeMode(false); setTargetPlayer(null); } }, [enabled]);
  useEffect(() => { if (targetPlayer !== null && !eligible(targetPlayer)) setTargetPlayer(null); }, [targetPlayer, enabled, snapshot]);
  useEffect(() => {
    if (!channel || !connected || !snapshot.room_id || snapshot.status === 'ended') { setFlights([]); return; }
    const roomId = snapshot.room_id;
    let active = true;
    const unsubscribe = channel.subscribe(value => {
      const event = readTableReaction(value, roomId, snapshot.match_id);
      if (!event || reactionIds.current.has(event.id)) return;
      reactionIds.current.add(event.id);
      if (reactionIds.current.size > 100) reactionIds.current = new Set([...reactionIds.current].slice(-50));
      const sender = seats.current.get(event.sender_player_id), receiver = seats.current.get(event.recipient_player_id);
      if (!sender || !receiver) return;
      root.current?.measureInWindow((rx, ry, width, height) => {
        sender.measureInWindow((sx, sy, sw, sh) => {
          receiver.measureInWindow((tx, ty, tw, th) => {
            if (!active || !sw || !tw || event.expires_at <= Date.now()) return;
            setFlights(current => [...current, { event, bounds: { width, height }, from: { x: sx - rx + sw / 2, y: sy - ry + Math.min(sh / 2, 24) }, to: { x: tx - rx + tw / 2, y: ty - ry + Math.min(th / 2, 24) } }].slice(-3));
          });
        });
      });
    });
    return () => { active = false; unsubscribe(); };
  }, [channel, connected, snapshot.room_id, snapshot.match_id, snapshot.status]);
  // Expiry rejects stale incoming events; an accepted flight stays until its
  // animation completes, including the longer recipient catch and fade.
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
  const addMessages = (incoming: TableMessage[], historical = false) => {
    const valid = incoming.filter(m => m.match_id === snapshot.match_id && m.room_id === snapshot.room_id);
    const fresh = valid.filter(m => !seen.current.has(m.id));
    valid.forEach(m => seen.current.add(m.id));
    if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200));
    setMessages(current => historical ? mergeTableMessages([], preserveRemovals(current,valid)) : mergeTableMessages(current, valid));
    if (!historical) {
      const received = fresh.filter(m => m.sender_id !== userId);
      if (!openRef.current) setUnread(n => n+received.length);
      setEffects(current => [...current, ...received.filter(m => Date.now()-m.sent_at < 5000).map(m => ({id:m.id,player:players.find(p => p.user_id === m.sender_id)?.player_id ?? -1,kind:"chat" as const,text:m.text,expires:Date.now()+3500}))].slice(-6));
    }
  };
  useEffect(() => {
    if (!channel || !canRead || !connected || !snapshot.match_id) return;
    const controller = new AbortController();
    const unsubscribe = channel.subscribe(value => {
      const message = value as TableMessage;
      if (message?.type === 'TABLE_CHAT_MESSAGE') addMessages([message]);
    });
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await channel!.request('TABLE_CHAT_HISTORY', snapshot.match_id!, {}, controller.signal);
        if (!controller.signal.aborted) { addMessages(result.messages || [], true); historyLoaded.current = true; }
      } catch (failure) { if (!controller.signal.aborted) setError(playerError(failure)); }
      finally { if (!controller.signal.aborted && blocking.enabled) timer = setTimeout(() => void refresh(), 3000); }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); unsubscribe(); };
  }, [channel, canRead, connected, snapshot.match_id, blocking.enabled, blocking.revision]);
  useEffect(() => {
    const fresh = pokes.filter(p => p.match_id === snapshot.match_id && p.expires_at > Date.now() && !seenPokes.current.has(p.id));
    fresh.forEach(p => seenPokes.current.add(p.id));
    if (seenPokes.current.size > 100) seenPokes.current = new Set([...seenPokes.current].slice(-50));
    if (fresh.length) setEffects(current => [...current, ...fresh.map(p => ({ id:p.id, player:players.find(row => row.user_id === (p.recipient_id ?? p.sender_id))?.player_id ?? -1, kind:"poke" as const, text:p.text, expires:Math.min(p.expires_at,Date.now()+3500) }))].slice(-6));
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
  }
  function openChat() { if (canRead) { setPokeMode(false); openRef.current = true; setOpen(true); setUnread(0); follow.current = true; } }
  function poke(id: number) {
    setPokeMode(false);
    if (eligible(id)) { setError(''); setTargetPlayer(id); }
  }
  async function sendReaction(reaction: ReactionId | 'punchline') {
    const id = targetPlayer;
    if (id === null) return;
    if (!eligible(id) || !channel || !snapshot.match_id || pokePending.current) return;
    const text = punchline.replace(/\s+/g, ' ').trim();
    if (reaction === 'punchline' && (!text || Array.from(text).length > PUNCHLINE_LIMIT)) return;
    pokePending.current = true; setSendingPoke(true);
    setError('');
    try { await channel.request('TABLE_POKE_SEND', snapshot.match_id, {recipient_player_id:id,reaction,...(reaction === 'punchline' ? {text} : {})}, lifetime.current.signal); if (!lifetime.current.signal.aborted) { setPokeSent(true); setTargetPlayer(null); setPokeMode(false); setPunchline(''); } }
    catch (failure) { if (!lifetime.current.signal.aborted) setError(playerError(failure)); }
    finally { pokePending.current = false; if (!lifetime.current.signal.aborted) setSendingPoke(false); }
  }
  async function send() {
    if (sendingRef.current || !enabled || !draft.trim() || Array.from(draft).length > 500 || !channel || !snapshot.match_id) return;
    const submitted = draft;
    sendingRef.current = true; setSending(true); setError('');
    try {
      const result = await channel.request('TABLE_CHAT_SEND', snapshot.match_id, {text:submitted}, lifetime.current.signal);
      if (!lifetime.current.signal.aborted) { if (result.message) addMessages([result.message]); setDraft(current => current === submitted ? '' : current); }
    } catch (failure) { if (!lifetime.current.signal.aborted) setError(playerError(failure)); }
    finally { sendingRef.current = false; if (!lifetime.current.signal.aborted) setSending(false); }
  }
  const iconStyle = { minWidth:44, minHeight:44, alignItems:'center' as const, justifyContent:'center' as const };
  function openPoke() { closeChat(); setError(''); setTargetPlayer(null); setPokeMode(true); }
  const presentation = (content: ReactNode, presentationExpanded: boolean) => (
    <View ref={node => { if (presentationExpanded === expandedRef.current) root.current = node; }} collapsable={false} style={{flex:presentationExpanded ? 1 : undefined,minHeight:0,minWidth:0,width:'100%'}} onLayout={measureRoot}>
      <GameModalContent>
      {content}
      {flights.map(flight => <TableReactionFlight key={flight.event.id} flight={flight} recipient={flight.event.recipient_id === userId}
        onComplete={() => setFlights(current => current.filter(item => item.event.id !== flight.event.id))} />)}
      <RoomSheet visible={pokeMode || targetPlayer !== null} title={ui("social.poke_a_player")} closeLabel={ui("common.close_poke_tools")} testID="poke-tools" presentation="dialog" onClose={() => { setPokeMode(false); setTargetPlayer(null); }}
        footer={<FormFooter><ChatComposer value={punchline} onChange={value=>setPunchline(Array.from(value).slice(0,PUNCHLINE_LIMIT).join(''))} onSend={() => void sendReaction('punchline')}
          disabled={sendingPoke || targetPlayer === null || !enabled} editable={!sendingPoke} maxLength={PUNCHLINE_LIMIT}
          label={ui('social.punchline_message')} sendLabel={ui('social.send_punchline')} placeholder={ui('social.your_own_little_punchline')} />
          {!!error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{uiLabel(error, 'feedback')}</Text>}
        </FormFooter>}>
        <Text style={{ color: c.textMuted, fontFamily: fonts.body }}>{ui("social.choose_a_player")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
          {players.filter(player => eligible(player.player_id)).map(player => <Pressable key={player.player_id}
            accessibilityRole="button" accessibilityLabel={ui("social.poke_player_2", { "player": player.display_name })} accessibilityState={{ selected: targetPlayer === player.player_id, disabled: sendingPoke }} disabled={sendingPoke}
            onPress={() => poke(player.player_id)} style={{width:76,minHeight:76,padding:6,gap:6,alignItems:'center',borderRadius:12,borderWidth:1,
              borderColor:targetPlayer===player.player_id?c.accent:'transparent',backgroundColor:targetPlayer===player.player_id?c.surfaceSelected:'transparent'}}>
            <PlayerAvatar uri={player.avatar_url}/><Text numberOfLines={2} style={{color:c.text,fontFamily:fonts.medium,fontSize:12,textAlign:'center'}}>{player.display_name}</Text>
          </Pressable>)}
        </ScrollView>
        {!players.some(player => eligible(player.player_id)) && <Text style={{ color: c.textMuted }}>{ui("social.no_other_seated_players_to_poke_yet")}</Text>}
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:4}}>
          {(Object.keys(tableReactions) as ReactionId[]).map(id => <Pressable key={id} accessibilityRole="button" accessibilityLabel={ui("social.send_reaction", { "reaction": uiLabel(tableReactions[id].label, 'social') })} disabled={sendingPoke || targetPlayer === null || !enabled} accessibilityState={{ disabled: sendingPoke || targetPlayer === null || !enabled }} onPress={() => void sendReaction(id)}
            style={({pressed})=>({minWidth:44,minHeight:48,alignItems:'center',justifyContent:'center',opacity:sendingPoke||targetPlayer===null?0.5:pressed?0.7:1})}>
            <Text style={{fontSize:30}}>{tableReactions[id].emoji}</Text>
          </Pressable>)}
        </View>
      </RoomSheet>
      {presentationExpanded && canRead && (!handCollapsed || !!error) && <View testID="game-social-controls" onTouchStart={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} style={{position:'absolute',right:14,bottom,zIndex:45,alignItems:'flex-end',maxWidth:240}}>
        {!!error && !open && <Pressable accessibilityRole="button" accessibilityLabel={ui("common.dismiss_social_error")} onPress={() => setError('')}><Text style={{color:c.danger,backgroundColor:c.surface,padding:6}}>{uiLabel(error, 'feedback')}</Text></Pressable>}
        {!handCollapsed && <View style={{flexDirection:'row',backgroundColor:c.tableHeader,borderColor:c.tableTrim,borderWidth:1,borderRadius:24}}>
          <Pressable accessibilityRole="button" accessibilityLabel={unread ? ui('common.chat_unread', { count: unread }) : ui('common.table_chat')} onPress={openChat} style={[iconStyle,{flexDirection:'row',paddingHorizontal:8}]}>
            <Ionicons name="chatbubble-outline" size={22} color={c.onTableHeader} />{unread > 0 && <Text testID="table-chat-unread" style={{color:c.onPrimary,backgroundColor:c.primary,borderRadius:10,fontSize:11,paddingHorizontal:5}}>{unread > 99 ? '99+' : unread}</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={ui("social.poke_a_player")} accessibilityState={{selected:pokeMode,disabled:!enabled}} disabled={!enabled} onPress={() => { closeChat(); setError(''); setTargetPlayer(null); setPokeMode(true); }} style={[iconStyle,{opacity:enabled?1:0.4,backgroundColor:pokeMode?c.surfaceSelected:undefined,borderRadius:24}]}><Text accessibilityLiveRegion="polite" accessibilityLabel={pokeSent ? ui("social.poke_sent") : undefined} style={{fontSize:20,color:c.onTableHeader}}>{pokeSent ? '✓' : '👋'}</Text></Pressable>
        </View>}
      </View>}
      {open && canRead && <RoomSheet visible tableStyle isolateKeyboard title={ui("common.table_chat")} testID="table-chat-panel" closeLabel={ui("common.close_table_chat")} onClose={closeChat} scrollable={false}>
        <View style={{flex:1,minHeight:0,gap:8,overflow:'hidden',padding:12,backgroundColor:c.background}}>
          {myTurn && <Pressable accessibilityRole="button" onPress={closeChat} style={{minHeight:44,justifyContent:'center'}}><Text accessibilityLiveRegion="polite" style={{color:c.accent}}>{ui("social.your_turn_return_to_game")}</Text></Pressable>}
          {/* RN Web's on-drag dismisses on every scroll, including auto-scroll and keyboard resizing. */}
          <ScrollView ref={scroll} testID="table-chat-messages" style={{flex:1,minHeight:0}} keyboardDismissMode={Platform.OS === 'web' ? 'none' : Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="always" onLayout={() => { if(follow.current) scroll.current?.scrollToEnd({animated:false}); }} onScroll={({nativeEvent:e}) => { follow.current = e.contentSize.height-e.contentOffset.y-e.layoutMeasurement.height < 40; }} scrollEventThrottle={16} onContentSizeChange={() => { if(follow.current) scroll.current?.scrollToEnd({animated:false}); }}>
            {!messages.length && <Text style={{color:c.textMuted}}>{ui("social.start_the_table_conversation")}</Text>}
            {messages.map(message => <ChatMessage tableStyle key={message.id} message={message} own={message.sender_id === userId} action={<ReportButton session={session} enabled={blocking.reporting} scope={message.ephemeral ? 'player' : 'chat'} messageId={message.ephemeral ? undefined : message.id} player={{user_id: message.sender_id, display_name: message.sender_name}} />} />)}
          </ScrollView>
          {!!error && <Text accessibilityRole="alert" style={{color:c.danger}}>{uiLabel(error, 'feedback')}</Text>}
          {reconnecting && <Text style={{color:c.textMuted}}>{ui("feedback.reconnecting")}</Text>}
          {seated ? <View testID="table-chat-composer" style={{flexShrink:0}}>
            <CommunityRulesEntry session={session} />
            <ChatComposer value={draft} onChange={setDraft} onSend={() => void send()} disabled={!enabled || sending}
              label={ui("social.table_message")} sendLabel={ui("common.send_table_message")} placeholder={t('chat.placeholder')} />
            <ChatInputDiagnostics />
          </View> : <Text style={{color:c.textMuted}}>{ui("social.waiting_players_can_read_take_a_seat_to_chat")}</Text>}
        </View>
      </RoomSheet>}
      </GameModalContent>
    </View>
  );
  return <Context.Provider value={{pokeMode,eligible,poke,effects,anchor,openChat,canRead,chatOpen:open&&canRead,overlayOpen:(open&&canRead)||pokeMode||targetPlayer!==null,registerSeat,presentation,openPoke,unread,enabled,pokeSent,setHandCollapsed}}>{children}</Context.Provider>;
}

export function TableSocialPresentation({children, expanded = true}: {children: ReactNode; expanded?: boolean}) {
  return useTableSocial()?.presentation(children, expanded) ?? children;
}

export function TableSocialButton({kind}: {kind:'chat'|'poke'}) {
  useUiLanguage();
  const social = useTableSocial(), {colors:c} = useTheme();
  if (!social?.canRead) return <View style={{width:44}} />;
  const chat = kind === 'chat', disabled = !chat && !social.enabled;
  return <Pressable testID={`collapsed-${kind}`} accessibilityRole="button"
    accessibilityLabel={chat ? social.unread ? ui('common.chat_unread',{count:social.unread}) : ui('common.table_chat') : ui('social.poke_a_player')}
    accessibilityState={{disabled}} disabled={disabled} onPress={chat ? social.openChat : social.openPoke}
    style={{minWidth:44,minHeight:48,alignItems:'center',justifyContent:'center',opacity:disabled?0.4:1}}>
    {chat ? <><Ionicons name="chatbubble-outline" size={22} color={c.onTableHeader} />{social.unread > 0 && <Text style={{color:c.onPrimary,backgroundColor:c.primary,borderRadius:10,paddingHorizontal:4}}>{social.unread > 99 ? '99+' : social.unread}</Text>}</> : <Text style={{fontSize:22}}>{social.pokeSent ? '✓' : '👋'}</Text>}
  </Pressable>;
}

export function PlayerSocialEffect({ playerId }: { playerId?: number }) {
  const uiLanguage = useUiLanguage();
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
