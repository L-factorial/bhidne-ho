import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import type { RoomPoke } from '../multiplayer/pokes';
import { fonts } from '../theme';

function PokeBubble({ poke, reduceMotion }: { poke: RoomPoke; reduceMotion: boolean }) {
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
    style={[styles.bubble, privatePoke && styles.privateBubble, reduceMotion && { backgroundColor: privatePoke ? '#BFF9ED' : '#FFE8A8', boxShadow: 'none' }, { opacity }]}>
    {!reduceMotion && <Animated.View style={[StyleSheet.absoluteFill, styles.glow, privatePoke && styles.privateGlow, { opacity: glow }]} />}
    <Text style={styles.label}>{privatePoke ? '✦ JUST FOR YOU' : '✦ TABLE TALK'} · PLAYER {poke.sender_player_id}</Text>
    <Text style={styles.text}>{poke.text}</Text>
  </Animated.View>;
}

export function PokeOverlay({ pokes, matchId }: { pokes: RoomPoke[]; matchId?: string }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; subscription.remove(); };
  }, []);
  return <View pointerEvents="none" style={styles.overlay}>
    {pokes.filter(poke => poke.match_id === matchId && poke.expires_at > Date.now()).map(poke =>
      <PokeBubble key={poke.id} poke={poke} reduceMotion={reduceMotion} />)}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 82, left: 12, right: 12, zIndex: 40, alignItems: 'center', gap: 8 },
  bubble: { width: '100%', maxWidth: 350, borderRadius: 20, borderWidth: 2, borderColor: '#FFE28C',
    backgroundColor: '#B96819', paddingHorizontal: 20, paddingVertical: 16, overflow: 'hidden',
    boxShadow: '0 0 30px rgba(255, 202, 90, 0.6)' },
  privateBubble: { backgroundColor: '#317C84', borderColor: '#AAFFF2', boxShadow: '0 0 30px rgba(100, 255, 225, 0.5)' },
  glow: { backgroundColor: '#FFDA72' }, privateGlow: { backgroundColor: '#90F8E5' },
  label: { color: '#102638', fontFamily: fonts.medium, fontSize: 10, letterSpacing: 1 },
  text: { color: '#102638', fontFamily: fonts.display, fontSize: 29, lineHeight: 35, marginTop: 6, textAlign: 'center' },
});
