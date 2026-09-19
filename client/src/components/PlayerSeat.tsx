import { PlayerSocialEffect, useTableSocial } from './TableSocial';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function PlayerSeat({ name, mine = false, active = false, connected = true, status, avatarUrl, compact = false, dealer = false,
  onPress, testID, registerSeat, playerId }: {
  playerId?: number;
  name: string; mine?: boolean; active?: boolean; connected?: boolean; status?: string;
  avatarUrl?: string; compact?: boolean; dealer?: boolean; onPress?: () => void; testID?: string;
  registerSeat?: (node: View | null) => void;
}) {
  const social = useTableSocial();
  const target = !!social?.pokeMode && playerId !== undefined && social.eligible(playerId);
  const press = target ? () => social!.poke(playerId!) : onPress;
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
  return <Pressable ref={registerSeat} testID={testID} accessibilityRole={press ? 'button' : undefined}
    onTouchStart={event => { if (target) event.stopPropagation(); }} onPointerDown={event => { if (target) event.stopPropagation(); }}
    onPress={press} disabled={!press} accessibilityLabel={`${target ? 'Poke ' : ''}${name}${mine ? ', You' : ''}${active ? ', current turn' : ''}${dealer ? ', dealer' : ''}${status ? `, ${status}` : ''}${!connected ? ', disconnected' : ''}`}
    style={{ width: '100%', alignItems: 'center', gap: 2, minHeight:44 }}>
    <PlayerSocialEffect playerId={playerId} />
    {target && <Text pointerEvents="none" style={{position:'absolute',right:0,top:0,fontSize:14}}>👋</Text>}
    <Animated.View style={{ transform: [{ scale }], width: size, height: size, borderRadius: size / 2, borderWidth: active ? 3 : 1,
      borderColor: target ? colors.accent : active ? colors.attention : colors.border, borderStyle: connected ? 'solid' : 'dashed',
      backgroundColor: active ? colors.turnSurface : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
      {avatarUrl && failedImage !== avatarUrl ? <Image source={{ uri: avatarUrl }} onError={() => setFailedImage(avatarUrl)}
        style={{ width: size - 6, height: size - 6, borderRadius: size / 2 }} /> : <Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: compact ? 12 : 16 }}>{initials}</Text>}
    </Animated.View>
    <Text numberOfLines={1} style={{ maxWidth: '100%', color: colors.text, fontFamily: fonts.medium, fontSize: compact ? 11 : 12 }}>{name}</Text>
    <Text numberOfLines={1} style={{ color: active ? colors.turnText : colors.textMuted, fontFamily: fonts.medium, fontSize: compact ? 8 : 10 }}>
      {active ? mine ? '● YOUR TURN' : '● TURN' : !connected ? 'Offline' : mine ? 'YOU' : dealer ? 'Dealer' : status}
    </Text>
    {(active || mine || !connected || dealer) && !!status && <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 10 }}>{!connected && active ? `Offline · ${status}` : status}</Text>}
  </Pressable>;
}
