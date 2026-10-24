import {useLiveEffects} from '../multiplayer/LivePresentationContext';
import {AppText as Text} from './AppText';
import { useEffect, useRef, useState } from 'react';
import {} from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { foldText } from '../notifications/gameNotification';
import { radii, useTheme } from '../theme';

export function FlushFoldNotice({ snapshot }: { snapshot: RoomSnapshot }) {
  const { colors } = useTheme();
  const liveEffects=useLiveEffects();
  const epoch=useRef(liveEffects.epoch);
  const last = useRef<number | null>(null);
  const [notice, setNotice] = useState('');
  const folds = snapshot.flush?.folds || [];
  const sequence = folds.at(-1)?.sequence || 0;
  useEffect(() => {
    const previous = last.current;
    last.current = Math.max(previous ?? 0, sequence);
    if (previous !== null && sequence < previous) setNotice('');
    if (epoch.current!==liveEffects.epoch || !liveEffects.active || !liveEffects.ready) {
      epoch.current=liveEffects.epoch;setNotice('');return;
    }
    if (previous === null || sequence <= previous) return;
    setNotice(folds.filter(fold => fold.sequence > previous).map(fold => foldText(snapshot, fold.player_id)).join(' · '));
  }, [sequence,liveEffects.epoch]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice, sequence]);
  return liveEffects.active&&liveEffects.ready&&notice ? <Text activity accessibilityLiveRegion="polite" testID="flush-fold-notice"
    style={{ color: colors.text, backgroundColor: colors.surfaceSelected, padding: 10, borderRadius: radii.medium, textAlign: 'center' }}>{notice}</Text> : null;
}
