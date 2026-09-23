import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { maalProgress } from '../multiplayer/maalProgress';
import { marriageFace, physicalLabel, type MarriageCard } from '../multiplayer/marriage';
import { fonts, useTheme } from '../theme';

export function MaalProgress({ hand }: { hand: MarriageCard[] }) {
  const { colors: c } = useTheme();
  const key = hand.map(card => card.card_id).join(',');
  const progress = useMemo(() => maalProgress(hand), [key]);
  const nearest = progress.normal.missing === progress.dublee.missing ? 'Both routes need the same number of additional cards.'
    : `${progress.normal.missing < progress.dublee.missing ? 'Three melds' : 'Seven Dublees'} needs fewer additional cards from this hand.`;
  return <View testID="marriage-maal-progress" style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ fontFamily: fonts.medium, fontSize: 20, color: c.accent }}>Your path to Maal</Text>
    <Text style={{ color: c.text, fontFamily: fonts.body }}>{nearest}</Text>
    {(['normal', 'dublee'] as const).map(route => {
      const plan = progress[route], total = route === 'normal' ? 3 : 7;
      return <View key={route} testID={`maal-route-${route}`} style={{ gap: 8, padding: 12, backgroundColor: c.tableHeader, borderRadius: 12, borderWidth: 1, borderColor: c.tableTrim }}>
        <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 16 }}>{route === 'normal' ? 'Three sequences / Tunnelas' : 'Seven Dublees'}</Text>
        <Text accessibilityLiveRegion="polite" style={{ color: plan.missing ? c.textMuted : c.success }}>{plan.complete}/{total} groups ready · {plan.missing ? `${plan.missing} more ${plan.missing === 1 ? 'card' : 'cards'} needed` : 'Ready to review and show'}</Text>
        <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: plan.complete }} accessibilityLabel={`${route === 'normal' ? 'Three melds' : 'Seven Dublees'} progress`} style={{ flexDirection: 'row', gap: 4 }}>
          {Array.from({ length: total }, (_, i) => <View key={i} style={{ height: 5, flex: 1, borderRadius: 3, backgroundColor: i < plan.complete ? c.attention : c.surfaceRaised }} />)}
        </View>
        {plan.groups.map((group, index) => <View key={index} style={{ gap: 3, paddingVertical: 6 }}>
          <Text style={{ color: c.text, fontFamily: fonts.medium }}>{index + 1}. {group.kind === 'pure_sequence' ? 'Sequence' : group.kind === 'tunnela' ? 'Tunnela' : 'Dublee'} · {group.missing.length ? `${group.held.length}/${group.held.length + group.missing.length} held` : 'Ready'}</Text>
          {!!group.held.length && <Text style={{ color: c.textMuted }}>Have: {group.held.map(card => physicalLabel(card.card_id)).join('  ·  ')}</Text>}
          {!!group.missing.length && <Text style={{ color: c.accent }}>{!group.held.length ? route === 'dublee' ? 'Need a new matching pair.' : 'Need a new natural sequence or Tunnela.' : `Need: ${group.missing.map(marriageFace).join(' + ')}`}</Text>}
        </View>)}
      </View>;
    })}
    <Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 }}>One shortest plan per route, using your whole hand. Each physical card is counted once per route; staged groups can be reorganized. Missing cards may not be available to draw. Natural groups only, Ace low; Man cannot substitute. Show all qualifying groups together after drawing on your turn.</Text>
  </View>;
}
