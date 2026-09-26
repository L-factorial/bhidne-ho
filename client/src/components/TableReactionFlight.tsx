import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Rect, Stop } from 'react-native-svg';
import { fonts, useTheme } from '../theme';
import { tableReactions, type TableReaction } from '../multiplayer/tableReactions';

export type ReactionFlight = { event: TableReaction; from: { x: number; y: number }; to: { x: number; y: number }; bounds?: { width: number; height: number } };

/** Measured seat positions are local to the viewer, so rotated seating stays correct. */
export function TableReactionFlight({ flight, recipient, onComplete }: { flight: ReactionFlight; recipient: boolean; onComplete: () => void }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const { event, from, to } = flight;
  const viewport = useWindowDimensions();
  const punchline = event.reaction === 'punchline';
  const bubbleGradient = `soap-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const progress = useRef(new Animated.Value(0)).current;
  const impact = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [arrived, setArrived] = useState(false);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduced(value); }).catch(() => { if (active) setReduced(true); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (reduced === null) return;
    progress.setValue(reduced ? 1 : 0); impact.setValue(0); opacity.setValue(1); setArrived(reduced);
    const travelMs = punchline ? 3400 : 1700;
    const arrival = setTimeout(() => setArrived(true), reduced ? 0 : travelMs);
    const animation = Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: reduced ? 0 : travelMs, useNativeDriver: true }),
      Animated.timing(impact, { toValue: 1, duration: reduced ? 0 : 800, useNativeDriver: true }),
      Animated.delay(punchline ? 1500 : recipient ? 2600 : 1300),
      Animated.timing(opacity, { toValue: 0, duration: reduced ? 0 : punchline ? 1200 : 500, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished) complete.current(); });
    return () => { clearTimeout(arrival); animation.stop(); };
  }, [reduced, progress, impact, opacity, recipient, punchline]);
  if (reduced === null) return null;
  if (event.reaction === 'punchline') {
    const bounds = flight.bounds || viewport;
    const bubbleWidth = Math.min(recipient ? 224 : 196, bounds.width * 0.76);
    const clampX = (x: number) => Math.max(bubbleWidth / 2 + 12, Math.min(bounds.width - bubbleWidth / 2 - 12, x));
    const clampY = (y: number) => Math.max(68, Math.min(bounds.height - 68, y - 68));
    const startY = clampY(from.y), endY = clampY(to.y);
    return <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 80 }}>
      <Animated.View testID="table-punchline-flight" accessibilityLiveRegion="polite" accessibilityLabel={`${event.sender_name}: ${event.text}`}
        style={{ position: 'absolute', left: -bubbleWidth / 2, top: -48, width: bubbleWidth, opacity,
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [clampX(from.x), clampX(to.x)] }) },
            { translateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [startY, Math.max(64, Math.min(startY, endY) - 60), endY] }) },
            { rotate: reduced ? '0deg' : progress.interpolate({ inputRange: [0, 0.3, 0.65, 1], outputRange: ['-6deg', '5deg', '-3deg', '0deg'] }) },
            { scale: reduced ? 1 : progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.55, 1, 1] }) },
            { scaleX: reduced ? 1 : impact.interpolate({ inputRange: [0, 0.3, 0.65, 1], outputRange: [1, 1.1, 0.96, 1] }) },
            { scaleY: reduced ? 1 : impact.interpolate({ inputRange: [0, 0.3, 0.65, 1], outputRange: [1, 0.78, 1.08, 1] }) },
          ] }}>
        <View style={{ minHeight: 88, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 28, borderTopLeftRadius: 34,
          borderBottomRightRadius: 32, borderWidth: recipient ? 2 : 1, borderColor: 'rgba(221,241,255,0.62)', backgroundColor: 'rgba(166,203,245,0.12)',
          boxShadow: '0px 5px 18px rgba(173,203,255,0.18)', gap: 5, justifyContent: 'center', overflow: 'hidden' }}>
          <Svg pointerEvents="none" accessible={false} width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
            <Defs><LinearGradient id={bubbleGradient} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#C5F5FF" stopOpacity={0.3} />
              <Stop offset="45%" stopColor="#C8BBFF" stopOpacity={0.12} />
              <Stop offset="80%" stopColor="#FFCBEA" stopOpacity={0.22} />
              <Stop offset="100%" stopColor="#BAF4ED" stopOpacity={0.32} />
            </LinearGradient></Defs>
            <Rect width="100%" height="100%" fill={`url(#${bubbleGradient})`} />
            <Ellipse cx="23%" cy="13%" rx="15%" ry="4%" fill="white" opacity={0.48} />
            <Ellipse cx="79%" cy="85%" rx="9%" ry="3%" fill="#FFE5F5" opacity={0.32} />
          </Svg>
          <Text numberOfLines={1} style={{ color: c.textMuted, fontFamily: fonts.medium, fontSize: 10, textAlign: 'center' }}>{event.sender_name}</Text>
          <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: recipient ? 16 : 14, lineHeight: 20, textAlign: 'center' }}>{event.text}</Text>
        </View>
        <View style={{ alignSelf: 'center', marginTop: -2, width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 4, borderTopWidth: 18,
          borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: 'rgba(200,218,255,0.38)', transform: [{ translateX: Math.max(-bubbleWidth / 2 + 20, Math.min(bubbleWidth / 2 - 20, to.x - clampX(to.x))) }] }} />
        {arrived && recipient && <Text testID="table-punchline-catch" style={{ color: c.text, backgroundColor: 'rgba(185,204,245,0.2)', padding: 6, borderRadius: 12, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center' }}>{ui('social.punchline_from', { player: event.sender_name })}</Text>}
      </Animated.View>
    </View>;
  }
  const reaction = tableReactions[event.reaction];
  return <View pointerEvents="none" accessible={false} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 80 }}>
    <Animated.View testID="table-reaction-flight" style={{ position: 'absolute', left: -28, top: -28, width: 56, height: 56, alignItems: 'center', justifyContent: 'center', opacity,
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [from.x, to.x] }) },
        { translateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [from.y, Math.max(32, Math.min(from.y, to.y) - 65), to.y] }) },
        { scale: reduced ? 1 : impact.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, recipient ? 2.3 : 1.5, recipient ? 1.7 : 1.15] }) },
      ] }}><Text style={{ fontSize: 42 }}>{reaction.emoji}</Text></Animated.View>
    {arrived && recipient && <Animated.View testID="table-reaction-catch" accessibilityLiveRegion="polite" accessibilityRole="alert"
      style={{ position: 'absolute', top: '25%', alignSelf: 'center', maxWidth: '85%', alignItems: 'center', padding: 16, borderRadius: 22, borderWidth: 2, borderColor: c.tableTrim, backgroundColor: c.tableHeader, boxShadow: `0px 8px 28px ${c.shadow}`, opacity }}>
      <Text style={{ fontSize: 48 }}>{reaction.emoji}</Text>
      <Text style={{ color: c.onTableHeader, fontFamily: fonts.medium, textAlign: 'center' }}>{ui("social.player_sent_you_reaction", { "player": event.sender_name, "reaction": uiLabel(reaction.label, 'social') })}</Text>
    </Animated.View>}
  </View>;
}
