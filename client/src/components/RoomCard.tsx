import { RoomShareActions } from './ShareLink';
import { Pressable, Text, View } from 'react-native';
import type { Room } from '../multiplayer/session';
import { fonts, useTheme } from '../theme';
export function RoomCard({ room, member, busy, activeTables, onPress }: { room: Room; member: boolean; busy: boolean; activeTables?: number; onPress: () => void }) {
  const { colors: c } = useTheme();
  return <View style={{ padding: 22, minHeight: 130, borderRadius: 16, backgroundColor: c.surface, gap: 12, opacity: busy ? 0.5 : 1 }}>
    <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 21 }}>{room.name}</Text>
    <RoomShareActions roomId={room.room_id} />
    <Text style={{ color: c.textMuted, fontFamily: fonts.body }}>{room.connected_members?.length || 0} online{activeTables !== undefined ? ` · ${activeTables} active ${activeTables === 1 ? 'table' : 'tables'}` : ''}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${member ? 'Enter' : 'Join'} ${room.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress} style={{ minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}><Text style={{ color: c.accent, fontFamily: fonts.medium }}>{member ? 'Enter' : 'Join'} →</Text></Pressable>
  </View>;
}
