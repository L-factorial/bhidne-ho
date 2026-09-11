import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { notificationKey, notificationText } from './gameNotification';
import { usePong } from './usePong';

export function useGameNotification(snapshot: RoomSnapshot | null, collapsed: boolean) {
  const { prepare, play } = usePong();
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState('');
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const previous = useRef('');
  const key = notificationKey(snapshot);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const old = previous.current;
    previous.current = key;
    if (!collapsed) { setNotice(''); return; }
    if (!snapshot || !old || key === old) return;
    setNotice(notificationText(snapshot));
    if (!muted) play();
  }, [key, collapsed, snapshot, muted, play]);
  useEffect(() => {
    if (!notice || !collapsed || reduceMotion) { opacity.setValue(1); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.55, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [notice, collapsed, reduceMotion, opacity]);
  return { opacity, notice, muted, prepare, toggleSound: () => { prepare(); setMuted(value => !value); } };
}
