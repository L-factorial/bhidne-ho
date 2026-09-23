import { gameControlFinish, gamePanelFinish, fonts, radii, typography, useTheme } from '../theme';
import { useState } from 'react';
import { ImageBackground, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RoomShareActions } from './ShareLink';
import { RoomSheet } from './RoomSheet';
import type { Room } from '../multiplayer/session';

export function RoomCard({ room, member, busy, activeTables, onPress }: { room: Room; member: boolean; busy: boolean; activeTables?: number; onPress: () => void }) {
  const { colors: c } = useTheme();
  const [sharing, setSharing] = useState(false);
  const [bannerWidth, setBannerWidth] = useState(340);
  const online = room.connected_members?.length || 0;
  const tables = room.table_count ?? activeTables ?? 0;
  const previews = room.member_previews || [];
  const shown = previews.length ? previews.slice(0, 4) : room.members.slice(0, 4).map(user_id => ({ user_id, display_name: '', username: '' }));
  const extra = Math.max(0, room.members.length - shown.length);
  return <View testID={`room-card-${room.room_id}`} style={{ ...gamePanelFinish(c), padding: 10, borderRadius: radii.large, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.borderSubtle, gap: 8, opacity: busy ? 0.55 : 1 }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingLeft: 3 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4, paddingTop: 3 }}>
        <Text numberOfLines={2} style={{ color: c.text, fontFamily: fonts.medium, fontSize: typography.cardTitle, lineHeight: 23 }}>{room.name}</Text>
        <Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 }}>
          {room.members.length} {room.members.length === 1 ? 'member' : 'members'} · {tables} {tables === 1 ? 'table' : 'tables'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6,
        marginTop: 3, borderRadius: 20, backgroundColor: online ? c.successSurface : c.surfaceRaised }}>
        <Ionicons name="people" size={12} color={online ? c.success : c.textMuted} />
        <Text style={{ color: online ? c.success : c.textMuted, fontFamily: fonts.medium, fontSize: 11 }}>{online} online</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Share ${room.name}`} onPress={() => setSharing(true)}
        style={({ pressed }) => ({ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: pressed ? c.surfaceRaised : 'transparent' })}>
        <Ionicons name="ellipsis-horizontal" size={20} color={c.textMuted} />
      </Pressable>
    </View>
    <ImageBackground source={require('../../assets/lobby/nepal-valley.jpg')} resizeMode="cover"
      onLayout={event => setBannerWidth(event.nativeEvent.layout.width)}
      style={{ height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: c.table }} imageStyle={{ width: bannerWidth, height: bannerWidth * 2 / 3, top: -bannerWidth * 0.1, opacity: 0.8 }}>
      <LinearGradient colors={['transparent', 'rgba(17,25,20,0.56)']} style={{ flex: 1, justifyContent: 'flex-end', padding: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
            {shown.map((player, index) => {
              const name = player.display_name || player.username || 'Room member';
              const initials = player.display_name || player.username ? name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase() : null;
              return <View key={player.user_id} accessible accessibilityLabel={name} style={{ width: 33, height: 33, borderRadius: 17,
                marginLeft: index ? -7 : 0, borderWidth: 2, borderColor: c.surface, backgroundColor: index % 2 ? c.surfaceSelected : c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
                {initials ? <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 11 }}>{initials}</Text> : <Ionicons name="person" size={15} color={c.textMuted} />}
              </View>;
            })}
            {!!extra && <View accessible accessibilityLabel={`${extra} more members`} style={{ marginLeft: -6, width: 33, height: 33, borderRadius: 17,
              borderWidth: 2, borderColor: c.surface, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 11 }}>+{extra}</Text>
            </View>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${member ? 'Enter' : 'Join'} ${room.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress}
            style={({ pressed }) => ({ ...gameControlFinish(c, pressed), minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: pressed ? c.primaryPressed : c.primary,
              flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' })}>
            <Text style={{ color: c.onPrimary, fontFamily: fonts.medium, fontSize: 13 }}>{member ? 'Enter' : 'Join'}</Text>
            <Ionicons name="arrow-forward" size={16} color={c.onPrimary} />
          </Pressable>
        </View>
      </LinearGradient>
    </ImageBackground>
    <RoomSheet visible={sharing} title={room.name} closeLabel="Close room sharing" onClose={() => setSharing(false)} presentation="dialog">
      <Text style={{ color: c.textMuted, fontFamily: fonts.body }}>Invite friends with the room code or link.</Text>
      <RoomShareActions roomId={room.room_id} />
    </RoomSheet>
  </View>;
}
