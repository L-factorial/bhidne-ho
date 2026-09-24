import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { MarriageCard, MarriageMeld } from '../multiplayer/marriage';
import { marriageFace } from '../multiplayer/marriage';
import { dubleeFinishProgress, finishingGaps, isMarriageWild, normalFinishProgress, type SeenMaal } from '../multiplayer/marriageFinishProgress';
import { fonts, gameButtonStyle, useTheme } from '../theme';
import { MarriageMeldCards } from './MarriageMeldCards';

export function MarriageFinishTool({ hand, shown, maal, route, topDiscard, canTakeDiscard, canFinish, busy, open, setOpen, onReview }: {
  hand: MarriageCard[]; shown: MarriageMeld[]; maal: SeenMaal; route: string; topDiscard?: MarriageCard | null;
  canTakeDiscard: boolean; canFinish: boolean; busy: boolean; open: boolean; setOpen: (value: boolean) => void; onReview: () => void;
}) {
  const uiLanguage = useUiLanguage();
  const { colors: c } = useTheme();
  const dublee = route === 'dublee';
  const key = hand.map(c => c.card_id).join(',') + JSON.stringify(shown) + JSON.stringify(maal);
  const pairPlan = useMemo(() => dublee ? dubleeFinishProgress(hand, shown, topDiscard) : null, [key, dublee, topDiscard?.card_id, uiLanguage]);
  const normal = useMemo(() => !dublee ? normalFinishProgress(hand, shown, maal) : null, [key, dublee, uiLanguage]);
  const gaps = useMemo(() => normal && !normal.ready ? finishingGaps(normal.unused, hand, maal) : [], [normal, uiLanguage]);
  const withDiscard = useMemo(() => normal && topDiscard && hand.length === 21 && !hand.some(c => c.card_id === topDiscard.card_id)
    ? normalFinishProgress([...hand, topDiscard], shown, maal) : null, [normal, topDiscard?.card_id, uiLanguage]);
  const ready = dublee ? !!pairPlan?.pairs.length : !!normal?.ready;
  const title = dublee ? ui("marriage.your_eighth_dublee") : ui("marriage.your_path_to_a_winning_hand");
  const status = dublee ? ready ? ui("marriage.eighth_dublee_ready") : ui("marriage.waiting_for_a_matching_card")
    : ready ? ui("marriage.winning_groups_ready") : ui("marriage.covered_target_remaining_cards_grouped", { "covered": normal?.covered, "target": normal?.target });
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label}
    disabled={disabled} accessibilityState={{ disabled }} onPress={action}
    style={({ pressed }) => ({ ...gameButtonStyle(c, 'secondary', pressed), opacity: disabled ? 0.5 : 1 })}>
    <Text style={{ color: c.onTableHeader, fontFamily: fonts.medium }}>{label}</Text>
  </Pressable>;
  const text = { color: c.text };
  const muted = { color: c.textMuted };
  const heading = { color: c.accent, fontFamily: fonts.medium, fontSize: 16 };
  const renderCards = (cards: MarriageCard[]) => <MarriageMeldCards hideLabels groups={[{ meld_type: 'set', card_ids: cards.map(c => c.card_id) }]} />;
  return <>
    <View testID="marriage-finish-tool-status" style={{ padding: 8, gap: 4, backgroundColor: ready ? c.successSurface : c.tableHeader }}>
      <Text accessibilityLiveRegion="polite" style={{ color: ready ? c.success : c.onTableHeader, fontFamily: fonts.medium }}>{status}</Text>
      {button(dublee ? ui("marriage.track_eighth_dublee") : ui("marriage.plan_winning_hand"), () => setOpen(true))}
    </View>
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: c.overlay, padding: 20, justifyContent: 'center', alignItems: 'center' }}>
        <View accessibilityViewIsModal testID="marriage-finish-tool" style={{ width: '100%', maxWidth: 640, maxHeight: '90%', backgroundColor: c.surface, borderRadius: 16, padding: 16, gap: 12 }}>
          <Text accessibilityRole="header" style={{ ...heading, fontSize: 20 }}>{title}</Text>
          {button(ui("common.close_finish_tool"), () => setOpen(false))}
          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <Text accessibilityLiveRegion="polite" style={heading}>{status}</Text>
            {pairPlan && <>
              <Text style={text}>Your seven shown pairs are locked. The eighth pair must use two remaining cards with the same natural face. Maal and Man cannot substitute.</Text>
              {!!pairPlan.pairs.length && <><Text style={heading}>{ui("marriage.ready_pairs")}</Text><MarriageMeldCards groups={pairPlan.pairs} />
                <Text style={muted}>The server chooses the finishing pair shown in the confirmation preview.</Text></>}
              {!!pairPlan.waiting.length && <><Text style={heading}>{ui("marriage.cards_waiting_for_a_partner")}</Text>
                {pairPlan.waiting.map(({ card, possibleCopies }) => <View key={card.card_id} style={{ gap: 4 }}>
                  {renderCards([card])}<Text style={possibleCopies ? text : muted}>{possibleCopies
                    ? ui("marriage.need_another_card", { "card": marriageFace(card) }) : ui("marriage.card_cannot_form_a_new_pair_the_other_two_copies_are_already_locked", { "card": marriageFace(card) })}</Text>
                </View>)}
                <Text style={muted}>Matching copies may be held by others or already discarded. This is not a prediction of available draws.</Text></>}
              {pairPlan.discardHelps && <Text style={{ color: c.success }}>{ui("marriage.visible_discard_pair", { "card": marriageFace(topDiscard!), "hint": canTakeDiscard ? ui("marriage.you_can_take_it_using_the_draw_control") : ui("marriage.wait_until_the_server_allows_this_draw") })}</Text>}
              {!!pairPlan.man.length && <><Text style={muted}>{ui("marriage.man_cannot_form_a_natural_dublee")}</Text>{renderCards(pairPlan.man)}</>}
            </>}
            {normal && <>
              <Text style={text}>Your shown sequences/Tunnelas stay locked. Group the remaining {normal.target} cards into valid sequences, sets or Tunnelas, keeping one final discard after drawing.</Text>
              <Text style={muted}>{ui("marriage.wildcards_hint", { "rank": marriageFace(maal.tiplu).slice(0, -1), "jhiplu": marriageFace(maal.jhiplu), "poplu": marriageFace(maal.poplu) })}</Text>
              {!!normal.groups.length && <><Text style={heading}>{ui("marriage.suggested_completed_groups")}</Text><MarriageMeldCards groups={normal.groups} /></>}
              {!!normal.unused.length && <><Text style={heading}>{normal.ready ? ui("marriage.suggested_final_discard") : ui("marriage.cards_outside_these_groups")}</Text>{renderCards(normal.unused)}</>}
              {!!gaps.length && <><Text style={heading}>{ui("marriage.one_card_gaps_among_the_remaining_cards")}</Text>
                {gaps.map((gap, index) => <View key={index} style={{ gap: 4 }}>{renderCards(gap.held)}
                  <Text style={text}>{ui("common.need_cards", { "cards": [gap.needed.map(marriageFace).join(', '), gap.wildHelps ? 'a wildcard' : ''].filter(Boolean).join(' or ') })}</Text>
                </View>)}
                <Text style={muted}>These are alternative groups; the same card cannot be used twice. Useful cards may not be available to draw.</Text></>}
              {!!withDiscard && (withDiscard.covered > normal.covered || withDiscard.ready) && <Text style={{ color: c.success }}>{ui("marriage.visible_discard_finish", { "card": marriageFace(topDiscard!), "result": withDiscard.ready ? ui("marriage.completes_a_winning_hand") : ui("marriage.improves_coverage_to_covered_target_cards", { "covered": withDiscard.covered, "target": withDiscard.target }), "hint": canTakeDiscard ? ui("marriage.you_can_take_it_using_the_draw_control") : ui("marriage.wait_until_the_server_allows_this_draw") })}</Text>}
              <Text style={muted}>This is one arrangement covering the most cards now, not a prediction of the fastest win. Groups can be rearranged as you draw. The server may choose another valid arrangement when finishing.</Text>
              {hand.some(card => !shown.some(g => g.card_ids.includes(card.card_id)) && isMarriageWild(card, maal)) && <Text style={muted}>Wildcards in your remaining hand are included in these suggestions.</Text>}
            </>}
            {(ready || canFinish) && <>{button(ui("marriage.review_finish"), () => { setOpen(false); onReview(); }, busy || !canFinish)}
              {!canFinish && <Text style={muted}>Finish becomes available when the server permits it after drawing on your turn.</Text>}</>}
            <Text style={heading}>{ui("marriage.locked_qualification_cards")}</Text><MarriageMeldCards groups={shown} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
