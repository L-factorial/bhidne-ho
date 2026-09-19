import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function PlayerSeat({ name, mine = false, active = false, connected = true, status, avatarUrl, compact = false, dealer = false,
  onPress, testID, registerSeat }: {
  name: string; mine?: boolean; active?: boolean; connected?: boolean; status?: string;
  avatarUrl?: string; compact?: boolean; dealer?: boolean; onPress?: () => void; testID?: string;
  registerSeat?: (node: View | null) => void;
}) {
  const { colors } = useTheme();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?';
  const scale = useRef(new Animated.Value(1)).current;
  const wasActive = useRef(active);
  useEffect(() => {
    const entering = active && !wasActive.current;
    wasActive.current = active;
    let mounted = true;
    if (entering) void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!mounted || reduced) return;
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 140, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }).catch(() => {});
    return () => { mounted = false; scale.stopAnimation(); scale.setValue(1); };
  }, [active, scale]);
  const size = compact ? 28 : 44;
  return <Pressable ref={registerSeat} testID={testID} accessibilityRole={onPress ? 'button' : undefined}
    onPress={onPress} disabled={!onPress} accessibilityLabel={`${name}${mine ? ', You' : ''}${active ? ', current turn' : ''}${dealer ? ', dealer' : ''}${status ? `, ${status}` : ''}${!connected ? ', disconnected' : ''}`}
    style={{ width: '100%', alignItems: 'center', gap: 2 }}>
    <Animated.View style={{ transform: [{ scale }], width: size, height: size, borderRadius: size / 2, borderWidth: active ? 3 : 1,
      borderColor: active ? colors.turnText : colors.border, borderStyle: connected ? 'solid' : 'dashed',
      backgroundColor: active ? colors.turnSurface : colors.surfaceSelected, alignItems: 'center', justifyContent: 'center' }}>
      {avatarUrl && failedImage !== avatarUrl ? <Image source={{ uri: avatarUrl }} onError={() => setFailedImage(avatarUrl)}
        style={{ width: size - 6, height: size - 6, borderRadius: size / 2 }} /> : <Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: compact ? 12 : 16 }}>{initials}</Text>}
    </Animated.View>
    <Text numberOfLines={1} style={{ maxWidth: '100%', color: colors.text, fontFamily: fonts.medium, fontSize: compact ? 11 : 12 }}>{name}</Text>
    <Text numberOfLines={1} style={{ color: active ? colors.turnText : colors.textMuted, fontFamily: fonts.medium, fontSize: 10 }}>
      {active ? mine ? compact ? '● YOU' : '● YOUR TURN' : '● TURN' : !connected ? 'Offline' : mine ? 'YOU' : dealer ? 'Dealer' : status}
    </Text>
    {(active || mine || !connected || dealer) && !!status && <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 10 }}>{!connected && active ? `Offline · ${status}` : status}</Text>}
  </Pressable>;
}
