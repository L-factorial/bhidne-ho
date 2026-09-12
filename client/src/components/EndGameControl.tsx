import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export function EndGameControl({ busy, onEnd }: { busy: boolean; onEnd: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const button = (label: string, onPress: () => void) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress}
    style={{ minHeight: 44, padding: 12, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
    <Text style={{ color: colors.copper, fontFamily: fonts.medium }}>{label}</Text>
  </Pressable>;
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
