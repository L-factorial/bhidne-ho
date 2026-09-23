import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, Text, View } from 'react-native';
import { RoomSheet } from './RoomSheet';
import { PlayerAvatar } from './PlayerAvatar';
import { MarriageMeldCards } from './MarriageMeldCards';
import { MarriageRoundResults } from './MarriageScoring';
import { fonts, gameButtonStyle, useTheme } from '../theme';
import { marriageAnnouncements, type MarriageAnnouncement } from '../multiplayer/marriageAnnouncements';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function MarriageAnnouncements({ snapshot }: { snapshot: RoomSnapshot }) {
  const { colors: c } = useTheme();
  const pub = snapshot.marriage?.public;
  const events = pub ? marriageAnnouncements(pub) : [];
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<MarriageAnnouncement[]>([]);
  const [review, setReview] = useState<MarriageAnnouncement | null>(null);
  const [tab, setTab] = useState<'cards' | 'results'>('cards');
  const [reduced, setReduced] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;
  const current = review || queue[0];
  useEffect(() => {
    if (!pub) return;
    // Hydration offers past declarations for review without replaying celebrations.
    const fresh = events.filter(event => seen.current ? !seen.current.has(event.id) : event.kind === 'win');
    if (!seen.current) seen.current = new Set();
    events.forEach(event => seen.current!.add(event.id));
    if (fresh.length) setQueue(previous => fresh.some(e => e.kind === 'win') ? fresh.filter(e => e.kind === 'win') : [...previous, ...fresh]);
  }, [pub]);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    setTab('cards');
    opacity.setValue(reduced ? 1 : 0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: reduced ? 0 : 280, useNativeDriver: true });
    animation.start();
    if (!current || review || current.kind === 'win') return () => animation.stop();
    const timer = setTimeout(() => setQueue(previous => previous.filter(e => e.id !== current.id)), 6500);
    return () => { clearTimeout(timer); animation.stop(); };
  }, [current?.id, !!review, reduced, opacity]);
  const close = () => { if (review) setReview(null); else setQueue(previous => previous.slice(1)); };
  const player = snapshot.players?.find(p => String(p.player_id) === current?.playerId);
  const name = player?.display_name || `Player ${current?.playerId}`;
  const win = current?.kind === 'win';
  const title = win ? `${name} won the round!` : `${name} unlocked Maal`;
  const action = (label: string, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => ({ ...gameButtonStyle(c, 'secondary', pressed), alignItems: 'center' })}><Text style={{ color: c.onTableHeader, fontFamily: fonts.medium }}>{label}</Text></Pressable>;
  const qualifications = events.filter(e => e.kind === 'qualification');
  const finish = events.find(e => e.kind === 'win');
  return <>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
      {!!qualifications.length && action('View shown cards', () => setReview(qualifications[qualifications.length - 1]))}
      {!!finish && action('View winning hand', () => setReview(finish))}
    </View>
    <RoomSheet visible={!!current} title={title} onClose={close} presentation="dialog" testID="marriage-announcement" closeLabel="Close table announcement">
      {current && <Animated.View style={{ opacity, gap: 14 }}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <PlayerAvatar uri={player?.avatar_url} />
          <Text accessibilityLiveRegion="polite" style={{ color: c.accent, fontFamily: fonts.medium, fontSize: win ? 24 : 19, textAlign: 'center' }}>{win ? '🏆 Round won!' : '✦ Maal unlocked'}</Text>
          <Text style={{ color: c.text, fontFamily: fonts.body, textAlign: 'center' }}>{name} {win ? current.dublee ? 'completed the 8th Dublee.' : 'completed a winning hand.' : current.dublee ? 'showed 7 Dublees.' : 'showed 3 sequences / Tunnelas.'}</Text>
        </View>
        {!!review && !win && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{qualifications.map(event => <View key={event.id}>{action(snapshot.players?.find(p => String(p.player_id) === event.playerId)?.display_name || `Player ${event.playerId}`, () => setReview(event))}</View>)}</View>}
        {win && <View style={{ flexDirection: 'row', gap: 8 }}>{action('Winning hand', () => setTab('cards'))}{action('Round results', () => setTab('results'))}</View>}
        {tab === 'results' ? <MarriageRoundResults snapshot={snapshot} /> : <>
          {win && current.dublee && <View style={{ gap: 8, borderWidth: 2, borderColor: c.attention, padding: 12, borderRadius: 16 }}>
            <Text style={{ color: c.accent, fontFamily: fonts.medium, textAlign: 'center' }}>Winning eighth pair</Text>
            {current.winningPair.length ? <MarriageMeldCards groups={[{ meld_type: 'dublee', card_ids: current.winningPair }]} /> : <Text style={{ color: c.textMuted }}>Winning pair unavailable in this snapshot.</Text>}
          </View>}
          {win && current.dublee && <Text style={{ color: c.textMuted }}>Seven previously shown Dublees</Text>}
          <MarriageMeldCards groups={current.groups} />
          {!!current.discard && <View style={{ gap: 8 }}><Text style={{ color: c.accent, fontFamily: fonts.medium }}>Final discard</Text><MarriageMeldCards groups={[{ meld_type: 'set', card_ids: [current.discard] }]} hideLabels /></View>}
        </>}
        {action(win ? 'Continue to table' : 'Back to table', close)}
      </Animated.View>}
    </RoomSheet>
  </>;
}
