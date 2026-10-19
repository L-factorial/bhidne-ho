import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { notificationKey, notificationText } from './gameNotification';
import {useForegroundSound} from './useForegroundSound';
import {gameSound} from './gameSound';

export function useGameNotification(snapshot: RoomSnapshot | null, collapsed: boolean, animate = true, connected = true) {
  const { prepare, play } = useForegroundSound();
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState('');
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const previous = useRef('');
  const soundSnapshot=useRef<RoomSnapshot|null>(null);
  useEffect(()=>{
    const reset=()=>{soundSnapshot.current=null;};
    const subscription=AppState.addEventListener('change',reset);
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',reset);
    return()=>{subscription.remove();if(typeof document!=='undefined')document.removeEventListener('visibilitychange',reset);};
  },[]);
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
    const cue=connected?gameSound(soundSnapshot.current,snapshot):null;
    soundSnapshot.current=connected?snapshot:null;
    if(cue&&!muted&&snapshot)play(cue,`game:${snapshot.match_id}:${snapshot.game?.revision}:${cue}:${key}`);
    if (!collapsed) { setNotice(''); return; }
    if (!snapshot || !old || key === old) return;
    setNotice(notificationText(snapshot));

  }, [key, collapsed, snapshot, muted, play, connected]);
  useEffect(() => {
    if (!animate || !notice || !collapsed || reduceMotion) { opacity.setValue(1); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.55, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [notice, collapsed, reduceMotion, opacity, animate]);
  return { opacity, notice, muted, prepare, toggleSound: () => { prepare(); setMuted(value => !value); } };
}
