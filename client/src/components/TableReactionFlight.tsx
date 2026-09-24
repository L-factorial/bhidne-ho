import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';
import { tableReactions, type TableReaction } from '../multiplayer/tableReactions';

export type ReactionFlight = { event: TableReaction; from: { x: number; y: number }; to: { x: number; y: number } };

/** Measured seat positions are local to the viewer, so rotated seating stays correct. */
export function TableReactionFlight({ flight, recipient, onComplete }: { flight: ReactionFlight; recipient: boolean; onComplete: () => void }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const { event, from, to } = flight;
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
    const arrival = setTimeout(() => setArrived(true), reduced ? 0 : 1700);
    const animation = Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: reduced ? 0 : 1700, useNativeDriver: true }),
      Animated.timing(impact, { toValue: 1, duration: reduced ? 0 : 800, useNativeDriver: true }),
      Animated.delay(recipient ? 2600 : 1300),
      Animated.timing(opacity, { toValue: 0, duration: reduced ? 0 : 500, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished) complete.current(); });
    return () => { clearTimeout(arrival); animation.stop(); };
  }, [reduced, progress, impact, opacity, recipient]);
  if (reduced === null) return null;
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
