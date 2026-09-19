import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme } from '../theme';

export function RoomToolbar({ panel, unread, chatBlocked, onChat, onMembers, onMore }: {
  panel: string | null; unread: number; chatBlocked: boolean;
  onChat: () => void; onMembers: () => void; onMore: () => void;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  return <View testID="room-toolbar" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: c.surface,
    borderTopWidth: 1, borderColor: c.border, paddingBottom: Math.max(8, insets.bottom), paddingHorizontal: Math.max(12, insets.left, insets.right) }}>
    <View style={{ flexDirection: 'row', width: '100%', maxWidth: 720, alignSelf: 'center' }}>
      {[
        { key: 'chat', label: chatBlocked ? 'Chat · paused' : 'Chat', action: onChat, disabled: chatBlocked },
        { key: 'members', label: 'Members', action: onMembers, disabled: false },
        { key: 'more', label: '••• More', action: onMore, disabled: false },
      ].map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.key === 'chat' ? 'Room chat' : item.key === 'more' ? 'More room actions' : 'Room members'}
        accessibilityHint={item.key === 'chat' && unread ? `${unread} unread messages` : undefined}
        accessibilityState={{ expanded: panel === item.key || (item.key === 'more' && panel === 'ledger'), disabled: item.disabled }} disabled={item.disabled}
        onPress={item.action} style={{ flex: 1, minHeight: 56, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', opacity: item.disabled ? 0.5 : 1 }}>
        <Text style={{ color: panel === item.key ? c.accent : c.text, fontFamily: fonts.medium, fontSize: 14 }}>{item.label}</Text>
        {item.key === 'chat' && unread > 0 && <Text testID="room-chat-unread" accessibilityLiveRegion="polite" style={{ color: c.onPrimary, backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2 }}>{unread}</Text>}
      </Pressable>)}
    </View>
  </View>;
}
