import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme } from '../theme';

export function RoomToolbar({ panel, unread, chatBlocked, onTables, onChat, onMembers, onMore }: {
  panel: string | null; unread: number; chatBlocked: boolean;
  onTables: () => void; onChat: () => void; onMembers: () => void; onMore: () => void;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  return <View testID="room-toolbar" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: c.surface,
    borderTopWidth: 1, borderColor: c.border, paddingBottom: Math.max(8, insets.bottom), paddingHorizontal: Math.max(12, insets.left, insets.right) }}>
    <View style={{ flexDirection: 'row', width: '100%', maxWidth: 720, alignSelf: 'center' }}>
      {[
        { key: 'tables', label: 'Tables', icon: 'grid-outline' as const, action: onTables, disabled: false },
        { key: 'chat', icon: 'chatbubble-outline' as const, label: chatBlocked ? 'Chat · paused' : 'Chat', action: onChat, disabled: chatBlocked },
        { key: 'members', icon: 'people-outline' as const, label: 'Members', action: onMembers, disabled: false },
        { key: 'more', icon: 'ellipsis-horizontal' as const, label: 'More', action: onMore, disabled: false },
      ].map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.key === 'chat' ? 'Room chat' : item.key === 'more' ? 'More room actions' : item.key === 'tables' ? 'Room tables' : 'Room members'}
        aria-pressed={(panel || 'tables') === item.key || (item.key === 'more' && panel === 'ledger')}
        accessibilityHint={item.key === 'chat' && unread ? `${unread} unread messages` : undefined}
        accessibilityState={{ selected: (panel || 'tables') === item.key || (item.key === 'more' && panel === 'ledger'), expanded: panel === item.key || (item.key === 'more' && panel === 'ledger'), disabled: item.disabled }} disabled={item.disabled}
        onPress={item.action} style={{ flex: 1, minHeight: 64, flexDirection: 'column', gap: 4, alignItems: 'center', justifyContent: 'center', opacity: item.disabled ? 0.5 : 1 }}>
        <Ionicons name={item.icon} size={21} color={(panel || 'tables') === item.key || (item.key === 'more' && panel === 'ledger') ? c.accent : c.textMuted} />
        <Text style={{ color: (panel || 'tables') === item.key || (item.key === 'more' && panel === 'ledger') ? c.accent : c.textMuted, fontFamily: fonts.medium, fontSize: 11 }}>{item.label}</Text>
        {item.key === 'chat' && unread > 0 && <Text testID="room-chat-unread" accessibilityLiveRegion="polite" style={{ position: 'absolute', top: 3, right: 18, color: c.onPrimary, backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2 }}>{unread}</Text>}
      </Pressable>)}
    </View>
  </View>;
}
