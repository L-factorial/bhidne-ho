import { View } from 'react-native';
import { AppText as Text } from './AppText';
import { RoomSheet } from './RoomSheet';
import { ui } from '../i18n/copy';
import type { UiKey } from '../i18n/catalogs';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { fonts, useTheme } from '../theme';
import { callBreakRuleGroups } from '../multiplayer/callbreakRules';
import type { RoomSnapshot } from '../screens/LiveGameTable';

/** Explanations only: configuration and proposal controls live in separate sheets. */
export function GameRules({ snapshot, visible, onClose }: { snapshot: RoomSnapshot; visible: boolean; onClose: () => void }) {
  useUiLanguage();
  const { colors } = useTheme();
  const sections: readonly (readonly [UiKey, UiKey])[] = snapshot.game_type === 'marriage' ? [
    ['common.deal_and_turns', 'marriage.deal_rules_help'],
    ['marriage.initial_tunnelas', 'marriage.tunnela_rules_help'],
    ['marriage.natural_groups', 'marriage.natural_rules_help'],
    ['marriage.seeing_maal', 'marriage.qualification_rules_help'],
    ['common.tiplu_jhiplu_poplu_and_alter', 'marriage.maal_rules_help'],
    ['marriage.winning_after_maal', 'marriage.winning_rules_help'],
    ['marriage.dublee_finish', 'marriage.dublee_rules_help'],
    ['common.points_and_privacy', 'marriage.privacy_rules_help'],
    ['marriage.folding', 'marriage.fold_rules_help'],
    ['marriage.scoring_rules', 'marriage.scoring_help'],
    ['common.game_rules_variations', 'marriage.config_variations_help'],
  ] : snapshot.game_type === 'flush' ? [
    ['common.deal_and_turns', 'flush.game_rules_help'],
    ['flush.boot_per_player_0_disables', 'flush.boot_help'],
    ['flush.bet', 'flush.betting_help'],
    ['flush.hand_ranking', 'flush.hand_ranking_help'],
    ['flush.show', 'flush.show_variations_help'],
    ['flush.ace_sequence_order', 'flush.ace_variations_help'],
    ['flush.equal_hands', 'flush.tie_variations_help'],
  ] : [
    ['common.deal_and_turns', 'callbreak.rules_help'],
    ['callbreak.choose_first_dealer', 'callbreak.dealer_draw_rules'],
    ...callBreakRuleGroups.map(group => [`callbreak.${group.toggle}`, `callbreak.${group.help}`] as const),
    ['callbreak.allow_weak_hand_redeal', 'callbreak.redeal_variations_help'],
    ['ledger.placement_bets_paid_to_first_place', 'ledger.bets_help'],
  ];
  return <RoomSheet visible={visible} title={ui('common.game_rules')} closeLabel={ui('common.close_game_rules')} onClose={onClose} testID="game-rules-explanation">
    {snapshot.game_type === 'callbreak' && <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 14, lineHeight: 22 }}>{ui('callbreak.configured_bid_help', {max: snapshot.rules?.bid_max || Math.floor(52 / (snapshot.capacity || 4)), bonus: snapshot.settings?.match_rules?.bonus_conversion_enabled ? snapshot.settings.match_rules.bonus_per_point : 10})}</Text>}
    {sections.map(([title, body]) => <View key={title} style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: 16 }}>{ui(title)}</Text>
      <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 14, lineHeight: 22 }}>{ui(body)}</Text>
    </View>)}
  </RoomSheet>;
}
