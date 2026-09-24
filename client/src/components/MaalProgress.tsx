import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { maalProgress } from '../multiplayer/maalProgress';
import { marriageFace, physicalLabel, type MarriageCard, type MarriageMeld } from '../multiplayer/marriage';
import { MarriageMeldCards } from './MarriageMeldCards';
import { fonts, gameButtonStyle, useTheme } from '../theme';

export function MaalProgress({ hand, topDiscard, canTakeDiscard = false, busy = false, onSelect, onReview }: {
  hand: MarriageCard[]; topDiscard?: MarriageCard | null; canTakeDiscard?: boolean; busy?: boolean;
  onSelect: (ids: string[]) => void; onReview: (groups: MarriageMeld[]) => void;
}) {
  const uiLanguage = useUiLanguage();
  const { colors: c } = useTheme();
  const key = hand.map(card => card.card_id).join(',');
  const progress = useMemo(() => maalProgress(hand), [key, uiLanguage]);
  const withDiscard = useMemo(() => topDiscard && !hand.some(card => card.card_id === topDiscard.card_id)
    ? maalProgress([...hand, topDiscard]) : null, [key, topDiscard?.card_id, uiLanguage]);
  const ready = (['normal', "dublee"] as const).filter(route => progress[route].missing === 0);
  const action = (label: string, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress}
    style={({ pressed }) => ({ ...gameButtonStyle(c, 'secondary', pressed), opacity: busy ? 0.5 : 1 })}><Text style={{ color: c.onTableHeader, fontFamily: fonts.medium }}>{label}</Text></Pressable>;
  const nearest = progress.normal.missing === progress.dublee.missing ? ui("marriage.both_routes_need_the_same_number_of_additional_cards")
    : ui("marriage.route_needs_fewer_additional_cards_from_this_hand", { "route": progress.normal.missing < progress.dublee.missing ? 'Three melds' : 'Seven Dublees' });
  return <View testID="marriage-maal-progress" style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ fontFamily: fonts.medium, fontSize: 20, color: c.accent }}>{ui("marriage.your_path_to_maal")}</Text>
    <Text style={{ color: c.text, fontFamily: fonts.body }}>{nearest}</Text>
    <Text style={{ color: c.textMuted }}>{ui("marriage.current_hand_progress", { "count": hand.length })}</Text>
    {!!ready.length && <View accessibilityLiveRegion="polite" style={{ padding: 12, gap: 8, backgroundColor: c.successSurface, borderRadius: 12 }}>
      <Text style={{ color: c.success, fontFamily: fonts.medium }}>{ready.length === 2 ? ui("marriage.both_routes_qualify_your_choice") : ui("marriage.a_qualifying_declaration_is_ready")}</Text>
      {ready.map(route => <View key={route}>{action(route === 'normal' ? ui("marriage.review_3_sequences_tunnelas") : ui("marriage.review_7_dublees"), () => onReview(progress[route].groups.map(g => ({ meld_type: g.kind, card_ids: g.held.map(card => card.card_id) }))))}</View>)}
      <Text style={{ color: c.success }}>Review now; show only when allowed on your turn. You may also keep playing.</Text>
    </View>}
    {(['normal', "dublee"] as const).map(route => {
      const plan = progress[route], total = route === 'normal' ? 3 : 7;
      return <View key={route} testID={`maal-route-${route}`} style={{ gap: 8, padding: 12, backgroundColor: c.tableHeader, borderRadius: 12, borderWidth: 1, borderColor: c.tableTrim }}>
        <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 16 }}>{route === 'normal' ? ui("marriage.three_sequences_tunnelas") : ui("marriage.seven_dublees")}</Text>
        <Text accessibilityLiveRegion="polite" style={{ color: plan.missing ? c.textMuted : c.success }}>{ui("common.progress_groups", { "ready": plan.complete, "total": total, "status": plan.missing ? `${plan.missing} more ${plan.missing === 1 ? 'card' : 'cards'} needed` : ui("marriage.ready_to_review_and_show") })}</Text>
        <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: plan.complete }} accessibilityLabel={ui("marriage.route_progress", { "route": route === 'normal' ? 'Three melds' : 'Seven Dublees' })} style={{ flexDirection: 'row', gap: 4 }}>
          {Array.from({ length: total }, (_, i) => <View key={i} style={{ height: 5, flex: 1, borderRadius: 3, backgroundColor: i < plan.complete ? c.attention : c.surfaceRaised }} />)}
        </View>
        {!!topDiscard && !!withDiscard && withDiscard[route].missing < plan.missing && <Text style={{ color: c.success }}>{ui("marriage.visible_discard_progress", { "card": marriageFace(topDiscard), "before": plan.missing, "after": withDiscard[route].missing, "hint": canTakeDiscard ? 'You may take it using the draw control.' : ui("marriage.wait_until_the_draw_action_allows_it") })}</Text>}
        {plan.groups.map((group, index) => <View key={index} style={{ gap: 3, paddingVertical: 6 }}>
          <Text style={{ color: c.text, fontFamily: fonts.medium }}>{index + 1}. {group.kind === 'pure_sequence' ? ui("marriage.sequence") : group.kind === 'tunnela' ? ui("marriage.tunnela") : ui("marriage.dublee")} · {group.missing.length ? ui("marriage.held_total_held", { "held": group.held.length, "total": group.held.length + group.missing.length }) : ui("rooms.ready")}</Text>
          {!!group.held.length && <Text style={{ color: c.textMuted }}>{ui("marriage.have_cards", { "cards": group.held.map(card => physicalLabel(card.card_id)).join('  ·  ') })}</Text>}
          {!!group.held.length && <MarriageMeldCards hideLabels groups={[{ meld_type: group.kind, card_ids: group.held.map(card => card.card_id) }]} />}
          {!!group.held.length && !!group.missing.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {group.missing.map((card, i) => <View key={i} accessibilityLabel={ui("marriage.needed_card", { "card": marriageFace(card) })} style={{ width: 44, height: 64, borderRadius: 6, borderStyle: 'dashed', borderWidth: 1, borderColor: c.attention, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.accent, fontSize: 18 }}>{marriageFace(card)}</Text><Text style={{ color: c.textMuted, fontSize: 9 }}>{ui("marriage.need")}</Text>
            </View>)}
          </View>}
          {!!group.missing.length && <Text style={{ color: c.accent }}>{!group.held.length ? route === 'dublee' ? ui("marriage.need_a_new_matching_pair") : ui("marriage.need_a_new_natural_sequence_or_tunnela") : ui("marriage.need_cards", { "cards": group.missing.map(marriageFace).join(' + ') })}</Text>}
          {!!group.held.length && action(ui("marriage.select_kind_group_number_in_my_hand", { "kind": route === 'normal' ? 'meld' : 'Dublee', "number": index + 1 }), () => onSelect(group.held.map(card => card.card_id)))}
        </View>)}
        {!!plan.unused.length && <View style={{ gap: 8 }}><Text style={{ color: c.text, fontFamily: fonts.medium }}>{ui("marriage.outside_this_plan_count_cards", { "count": plan.unused.length })}</Text>
          <MarriageMeldCards hideLabels groups={[{ meld_type: 'set', card_ids: plan.unused.map(card => card.card_id) }]} />
          <Text style={{ color: c.textMuted }}>These may help another combination or become useful after Maal. They are not automatic discard suggestions.</Text>
        </View>}
      </View>;
    })}
    <Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 }}>One shortest plan per route, using your whole hand. Each physical card is counted once per route; staged groups can be reorganized. Missing cards may not be available to draw. Natural groups only, Ace low; Man cannot substitute. Show all qualifying groups together after drawing on your turn.</Text>
  </View>;
}
