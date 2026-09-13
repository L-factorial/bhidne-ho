import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { foldText } from '../notifications/gameNotification';
import { useTheme } from '../theme';

export function FlushFoldNotice({ snapshot }: { snapshot: RoomSnapshot }) {
  const { colors } = useTheme();
  const last = useRef<number | null>(null);
  const [notice, setNotice] = useState('');
  const folds = snapshot.flush?.folds || [];
  const sequence = folds.at(-1)?.sequence || 0;
  useEffect(() => {
    const previous = last.current;
    last.current = Math.max(previous ?? 0, sequence);
    if (previous !== null && sequence < previous) setNotice('');
    if (previous === null || sequence <= previous) return;
    setNotice(folds.filter(fold => fold.sequence > previous).map(fold => foldText(snapshot, fold.player_id)).join(' · '));
  }, [sequence]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice, sequence]);
  return notice ? <Text accessibilityLiveRegion="polite" testID="flush-fold-notice"
    style={{ color: colors.text, backgroundColor: colors.surfaceSelected, padding: 10, borderRadius: 8, textAlign: 'center' }}>{notice}</Text> : null;
}
