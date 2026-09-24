import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { maalChoices, type MaalChoice } from '../multiplayer/maalProgress';
import type { MarriageCard, MarriageMeld } from '../multiplayer/marriage';
import { fonts, gameButtonStyle, useTheme } from '../theme';
import { MarriageMeldCards } from './MarriageMeldCards';

/** Private, non-blocking notice; only the existing Show confirmation sends cards. */
export function MaalReady({ hand, busy, onReview }: {
  hand: MarriageCard[]; busy: boolean; onReview: (groups: MarriageMeld[]) => void;
}) {
  const uiLanguage = useUiLanguage();
  const { colors: c } = useTheme();
  const key = hand.map(card => card.card_id).sort().join(',');
  const choices = useMemo(() => maalChoices(hand), [key, uiLanguage]);
  const [open, setOpen] = useState(false);
  const [route, setRoute] = useState<MaalChoice['route']>('normal');
  const [page, setPage] = useState(0);
  const normal = choices.filter(choice => choice.route === 'normal');
  const dublee = choices.filter(choice => choice.route === 'dublee');
  const activeRoute = route === 'normal' ? (normal.length ? 'normal' : ui("marriage.dublee")) : (dublee.length ? ui("marriage.dublee") : 'normal');
  const options = activeRoute === 'normal' ? normal : dublee;
  const index = Math.min(page, options.length - 1);
  const choice = options[index];
  const button = (label: string, onPress: () => void, disabled = false, selected = false) => <Pressable
    accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => ({ ...gameButtonStyle(c, selected ? 'primary' : 'secondary', pressed), opacity: disabled ? 0.5 : 1 })}>
    <Text style={{ color: selected ? c.onPrimary : c.onTableHeader, fontFamily: fonts.medium }}>{label}</Text>
  </Pressable>;
  if (!choice) return null;
  return <>
    <View testID="marriage-maal-ready" style={{ padding: 8, gap: 4, backgroundColor: c.successSurface }}>
      <Text accessibilityLiveRegion="polite" style={{ color: c.success, fontFamily: fonts.medium }}>
        {ui('marriage.eligible_combination_count', { count: choices.length })}</Text>
      {button(ui("marriage.choose_cards_to_show"), () => setOpen(true), busy)}
    </View>
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: c.overlay, padding: 20, justifyContent: 'center', alignItems: 'center' }}>
        <View accessibilityViewIsModal testID="marriage-maal-choices" style={{ width: '100%', maxWidth: 640, maxHeight: '90%', padding: 16, borderRadius: 16, gap: 12, backgroundColor: c.surface }}>
          <Text accessibilityRole="header" style={{ color: c.accent, fontFamily: fonts.medium, fontSize: 20 }}>{ui("marriage.choose_your_route_to_maal")}</Text>
          {button(ui("common.keep_playing"), () => setOpen(false))}
          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <Text style={{ color: c.text }}>Only you can see these options. Review a combination, then show it after drawing on your turn.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {!!normal.length && button(ui("common.3_sequences_tunnelas_options", { "options": normal.length }), () => { setRoute('normal'); setPage(0); }, false, activeRoute === 'normal')}
              {!!dublee.length && button(ui("common.7_dublees_options", { "options": dublee.length }), () => { setRoute("dublee"); setPage(0); }, false, activeRoute === 'dublee')}
            </View>
            <Text accessibilityLiveRegion="polite" style={{ color: c.text }}>{ui("marriage.combination_number_of_total", { "number": index + 1, "total": options.length })}</Text>
            <MarriageMeldCards groups={choice.groups} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {button(ui("marriage.previous_combination"), () => setPage(index - 1), index === 0)}
              {button(ui("marriage.next_combination"), () => setPage(index + 1), index === options.length - 1)}
            </View>
            {button(ui("marriage.review_this_combination"), () => { setOpen(false); onReview(choice.groups); }, busy, true)}
            <Text style={{ color: c.textMuted }}>Identical copies from different decks count as the same combination. You can still arrange cards manually.</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
