import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { RoomPoke } from '../multiplayer/pokes';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

function PokeBubble({ poke, reduceMotion }: { poke: RoomPoke; reduceMotion: boolean }) {
  const uiLanguage = useUiLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const opacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(1)).current;
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const remaining = Math.max(0, Math.min(5000, poke.expires_at - Date.now()));
    if (!remaining) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(false), remaining);
    opacity.setValue(reduceMotion ? 1 : 0); glow.setValue(1);
    const animation = reduceMotion ? null : Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(remaining * 0.3),
        Animated.timing(opacity, { toValue: 0.55, duration: remaining * 0.3, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: Math.max(0, remaining * 0.4 - 180), useNativeDriver: true }),
      ]),
      Animated.timing(glow, { toValue: 0, duration: remaining * 0.65, useNativeDriver: true }),
    ]);
    animation?.start();
    return () => { clearTimeout(timer); animation?.stop(); };
  }, [poke.id, poke.expires_at, reduceMotion, opacity, glow]);
  if (!visible) return null;
  const privatePoke = poke.scope === 'private';
  return <Animated.View testID="poke-popup" accessibilityLiveRegion="polite" accessibilityRole="alert"
    style={[styles.bubble, privatePoke && styles.privateBubble, reduceMotion && { backgroundColor: privatePoke ? colors.success : colors.accent, boxShadow: 'none' }, { opacity }]}>
    {!reduceMotion && <Animated.View style={[StyleSheet.absoluteFill, styles.glow, privatePoke && styles.privateGlow, { opacity: glow }]} />}
    <Text style={styles.label}>{privatePoke ? '✦ JUST FOR YOU' : '✦ TABLE TALK'} · {poke.sender_name || ui("common.player_number", { "number": poke.sender_player_id })}</Text>
    <Text style={styles.text}>{poke.text}</Text>
  </Animated.View>;
}

export function PokeOverlay({ pokes, matchId }: { pokes: RoomPoke[]; matchId?: string }) {
  const uiLanguage = useUiLanguage();
  const styles = useThemedStyles(createStyles);
  const compact = useWindowDimensions().width < 900;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; subscription.remove(); };
  }, []);
  const visible = pokes.filter(poke => poke.match_id === matchId && poke.expires_at > Date.now()).slice(-2);
  return <View pointerEvents="none" testID="poke-overlay" style={[styles.overlay, compact && styles.compactOverlay]}>
    {visible.map(poke =>
      <PokeBubble key={poke.id} poke={poke} reduceMotion={reduceMotion} />)}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  // Keep table talk in the play surface. Mobile card drawers use zIndex 30,
  // so an expanded hand always covers this layer instead of being obscured by it.
  overlay: { position: 'absolute', top: '38%', left: 12, right: 12, zIndex: 24, alignItems: 'center', gap: 8 },
  compactOverlay: { top: '32%', left: 8, right: 8 },
  bubble: { width: '100%', maxWidth: 350, borderRadius: 20, borderWidth: 2, borderColor: colors.accent,
    backgroundColor: colors.surfaceSelected, paddingHorizontal: 20, paddingVertical: 16, overflow: 'hidden',
    boxShadow: `0 4px 20px ${colors.shadow}` },
  privateBubble: { backgroundColor: colors.successSurface, borderColor: colors.success, boxShadow: `0 4px 20px ${colors.shadow}` },
  glow: { backgroundColor: colors.accent }, privateGlow: { backgroundColor: colors.success },
  label: { color: colors.text, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 1 },
  text: { color: colors.text, fontFamily: fonts.display, fontSize: 29, lineHeight: 35, marginTop: 6, textAlign: 'center' },
});
