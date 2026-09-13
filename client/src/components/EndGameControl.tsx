import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function EndGameControl({ busy, onEnd, compact = false, table = false }: { table?: boolean; compact?: boolean; busy: boolean; onEnd: () => Promise<void> }) {
  const { colors } = useTheme();
  const label = table ? 'End table' : 'End game';
  const confirmation = table ? 'End this table for everyone? The current round will stop and no further rounds can start. The room stays open.' : 'End this game for everyone? Play will stop without declaring a winner. The room stays open.';
  const [confirming, setConfirming] = useState(false);
  const button = (label: string, onPress: () => void) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress}
    style={{ minHeight: 44, padding: 12, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
    <Text style={{ color: colors.accent, fontFamily: fonts.medium }}>{label}</Text>
  </Pressable>;
  if (compact) return <View>
    {button(label, () => setConfirming(true))}
    <Modal transparent visible={confirming} animationType="fade" onRequestClose={() => setConfirming(false)}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 20, maxWidth: 400, width: '100%' }}>
          <Text accessibilityRole="alert" style={{ color: colors.text, fontFamily: fonts.body }}>{confirmation}</Text>
          {button('Keep playing', () => setConfirming(false))}
          {button(`${label} for everyone`, () => { void onEnd(); })}
        </View>
      </View>
    </Modal>
  </View>;
  return <View style={{ backgroundColor: colors.surface, paddingHorizontal: 12, borderRadius: 8 }}>
    {confirming ? <>
      <Text accessibilityRole="alert" style={{ color: colors.text, paddingTop: 12, fontFamily: fonts.body }}>
        {confirmation}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {button('Keep playing', () => setConfirming(false))}
        {button(`${label} for everyone`, () => { void onEnd(); })}
      </View>
    </> : button(label, () => setConfirming(true))}
  </View>;
}
