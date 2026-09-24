import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Ionicons } from '@expo/vector-icons';
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
  useUiLanguage();
  const social = useTableSocial();
  const target = !!social?.pokeMode && playerId !== undefined && social.eligible(playerId);
  const press = target ? () => social!.poke(playerId!) : onPress;
  const { colors } = useTheme();
  const [failedImage, setFailedImage] = useState<string | null>(null);
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
  return <Pressable ref={node => { registerSeat?.(node); if (playerId !== undefined) social?.registerSeat(playerId, node); }} collapsable={false} testID={testID} accessibilityRole={press ? 'button' : undefined}
    onTouchStart={event => { if (target) event.stopPropagation(); }} onPointerDown={event => { if (target) event.stopPropagation(); }}
    onPress={press} disabled={!press} accessibilityLabel={`${target ? ui("social.poke") : ''}${name}${mine ? ', You' : ''}${active ? ', current turn' : ''}${dealer ? ', dealer' : ''}${status ? `, ${status}` : ''}${!connected ? ', disconnected' : ''}`}
    style={{ width: '100%', alignItems: 'center', gap: 2, minHeight:44 }}>
    <PlayerSocialEffect playerId={playerId} />
    {target && <Text pointerEvents="none" style={{position:'absolute',right:0,top:0,fontSize:14}}>👋</Text>}
    <Animated.View style={{ transform: [{ scale }], width: size, height: size, borderRadius: size / 2, borderWidth: active ? 3 : 1,
      borderColor: target ? colors.accent : active ? colors.attention : '#DCC9A5', borderStyle: connected ? 'solid' : 'dashed',
      backgroundColor: active ? colors.turnSurface : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
      {avatarUrl && failedImage !== avatarUrl ? <Image source={{ uri: avatarUrl }} onError={() => setFailedImage(avatarUrl)}
        style={{ width: size - 6, height: size - 6, borderRadius: size / 2 }} /> : <View style={{ width: size - 6, height: size - 6, borderRadius: size / 2, backgroundColor: '#E5E5E5', alignItems: 'center', justifyContent: 'center' }}><Ionicons accessibilityLabel={ui("common.anonymous_profile")} name="person" size={compact ? 18 : 28} color="#737373" /></View>}
    </Animated.View>
    <Text numberOfLines={1} style={{ maxWidth: '100%', backgroundColor: colors.surface, paddingHorizontal: 8, borderRadius: 8, color: colors.text, fontFamily: fonts.medium, fontSize: compact ? 11 : 12 }}>{name}</Text>
    <Text numberOfLines={1} style={{ backgroundColor: active ? colors.turnSurface : colors.surface, paddingHorizontal: 5, borderRadius: 5, color: active ? colors.turnText : colors.textMuted, fontFamily: fonts.medium, fontSize: compact ? 8 : active && mine ? 9 : 10 }}>
      {active ? mine ? ui("common.you") : `● ${ui('common.turn')}` : !connected ? ui("rooms.offline") : mine ? ui("common.you") : dealer ? ui("common.dealer") : uiLabel(status || '')}
    </Text>
    {(active || mine || !connected || dealer) && !!status && <Text numberOfLines={1} style={{ backgroundColor: colors.surface, paddingHorizontal: 5, borderRadius: 5, color: colors.textMuted, fontSize: 10 }}>{!connected && active ? ui("common.offline_player", { "player": uiLabel(status || '') }) : uiLabel(status || '')}</Text>}
  </Pressable>;
}
