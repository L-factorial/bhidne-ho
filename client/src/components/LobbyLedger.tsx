import {ActivityLine} from './ActivityLine';
import {useEffect, useState} from 'react';
import {Pressable, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {AppText as Text} from './AppText';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {request} from '../multiplayer/api';
import {playerError} from '../multiplayer/playerError';
import type {Room, Session} from '../multiplayer/session';
import {fonts, gamePanelFinish, radii, useTheme} from '../theme';

type PendingRoom = {room_id: string; name: string; latest_game_at?: string | null};
type Page = {items: PendingRoom[]; next_room_id?: string | null};

export function LobbyLedger({session, onOpenRoom}: {session: Session; onOpenRoom: (room: Room) => void}) {
  const language = useUiLanguage();
  const {colors} = useTheme();
  const [rooms, setRooms] = useState<PendingRoom[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {setRooms(undefined); setError('');}, [session.user_id]);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const collected: PendingRoom[] = [], cursors = new Set<string>();
        let cursor = '';
        do {
          const page = await request<Page>(`/ledger/rooms?after_room_id=${encodeURIComponent(cursor)}`, session, undefined, controller.signal);
          collected.push(...page.items);
          cursor = page.next_room_id || '';
          if (cursor && cursors.has(cursor)) throw new Error(ui('feedback.could_not_load_ledger'));
          cursors.add(cursor);
        } while (cursor && !controller.signal.aborted);
        if (!controller.signal.aborted) {setRooms(collected); setError('');}
      } catch (e) {
        if (!controller.signal.aborted) setError(playerError(e, ui('feedback.could_not_load_ledger')));
      } finally {loading = false;}
    }
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {controller.abort(); clearInterval(timer);};
  }, [session.token, session.user_id, language, retry]);
  return <View testID="lobby-ledger" style={{gap: 16, paddingVertical: 18}}>
    <Text style={{fontFamily: fonts.display, fontSize: 24, color: colors.text, textAlign: 'center'}}>{ui('ledger.ledger')}</Text>
    <Text style={{fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, textAlign: 'center'}}>{ui('ledger.pending_rooms')}</Text>
    {!!error && <View style={{gap: 8, alignItems: 'center'}}>
      <Text activity accessibilityRole="alert" style={{color: colors.danger}}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={{minHeight: 44, justifyContent: 'center'}}><Text style={{color: colors.accent}}>{ui('common.retry')}</Text></Pressable>
    </View>}
    {!rooms && !error && <View style={{minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10}}><ActivityLine /></View>}
    {rooms?.length === 0 && <View style={{...gamePanelFinish(colors), borderRadius: radii.large, borderWidth: 1, borderColor: colors.borderSubtle, padding: 28, alignItems: 'center', gap: 12}}><Ionicons name="receipt-outline" size={28} color={colors.textMuted} /><Text style={{color: colors.textMuted, textAlign: 'center'}}>{ui('ledger.no_pending_rooms')}</Text></View>}
    {rooms?.map(room => <Pressable key={room.room_id} testID={`pending-ledger-room-${room.room_id}`} accessibilityRole="button" accessibilityLabel={room.name}
      onPress={() => onOpenRoom({...room, members: [session.user_id]})}
      style={({pressed}) => ({...gamePanelFinish(colors), opacity: pressed ? 0.75 : 1, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radii.large, padding: 16, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12})}>
      <Ionicons name="receipt-outline" size={23} color={colors.accent} /><View style={{flex: 1, minWidth: 0, gap: 5}}><Text style={{fontFamily: fonts.medium, color: colors.text}}>{room.name}</Text>
        {room.latest_game_at && Number.isFinite(Date.parse(room.latest_game_at)) && <Text style={{fontSize: 12, color: colors.textMuted}}>{new Date(room.latest_game_at).toLocaleDateString(language === 'ne' ? 'ne-NP' : 'en-US', {month: 'short', day: 'numeric', year: 'numeric'})}</Text>}
      </View><Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>)}
  </View>;
}
