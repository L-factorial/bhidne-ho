import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export function EndGameControl({ busy, onEnd, compact = false }: { compact?: boolean; busy: boolean; onEnd: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const button = (label: string, onPress: () => void) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress}
    style={{ minHeight: 44, padding: 12, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
    <Text style={{ color: colors.copper, fontFamily: fonts.medium }}>{label}</Text>
  </Pressable>;
  if (compact) return <View>
    {button('End game', () => setConfirming(true))}
    <Modal transparent visible={confirming} animationType="fade" onRequestClose={() => setConfirming(false)}>
      <View style={{ flex: 1, backgroundColor: '#020A14CC', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: colors.ivory, borderRadius: 12, padding: 20, maxWidth: 400, width: '100%' }}>
          <Text accessibilityRole="alert" style={{ color: colors.ink, fontFamily: fonts.body }}>End this game for everyone? Play will stop without declaring a winner. The room stays open.</Text>
          {button('Keep playing', () => setConfirming(false))}
          {button('End game for everyone', () => { void onEnd(); })}
        </View>
      </View>
    </Modal>
  </View>;
  return <View style={{ backgroundColor: colors.ivory, paddingHorizontal: 12, borderRadius: 8 }}>
    {confirming ? <>
      <Text accessibilityRole="alert" style={{ color: colors.ink, paddingTop: 12, fontFamily: fonts.body }}>
        End this game for everyone? Play will stop without declaring a winner. The room stays open.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {button('Keep playing', () => setConfirming(false))}
        {button('End game for everyone', () => { void onEnd(); })}
      </View>
    </> : button('End game', () => setConfirming(true))}
  </View>;
}
