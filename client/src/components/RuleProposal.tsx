import {AppText as Text} from './AppText';
import { GameModal as Modal } from './GameModal';
import { ruleFieldLabel, ruleValueLabel } from '../i18n/ruleCopy.ts';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useState } from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import { useTheme } from '../theme';

export type RuleProposalView = {
  id: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED'; proposer_name: string;
  voters: string[]; accepted: string[]; can_vote: boolean;
  previous: Record<string, unknown>; proposed: Record<string, unknown>;
};
const flatten = (value: Record<string, unknown>, prefix = ''): [string, unknown][] => Object.entries(value).flatMap(([key, item]) =>
  item && typeof item === 'object' && !Array.isArray(item) ? flatten(item as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, item]]);
const show = (value: unknown) => typeof value === 'boolean' ? value ? ui("common.yes") : ui("common.no") : typeof value === 'string' ? ruleValueLabel(value) : JSON.stringify(value);
export function RuleProposal({ proposal, busy, vote, userId, error }: { proposal: RuleProposalView; busy: boolean; userId: string; error?: string; vote: (accept: boolean) => void }) {
  useUiLanguage();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const blocking = false;
  const old = Object.fromEntries(flatten(proposal.previous));
  const changes = flatten(proposal.proposed).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(old[key]));
  return <View style={{ padding: 10, backgroundColor: colors.surface }}>
    <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.review_rule_change")} onPress={() => setOpen(true)}>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.accent }}>{ui('common.config_updated')}</Text>
    </Pressable>
    <Modal transparent visible={blocking || open} onRequestClose={() => { if (!blocking) setOpen(false); }} animationType="fade">
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 }}>
        <View accessibilityViewIsModal testID="rule-proposal-dialog" style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 16, maxHeight: '85%', width: '100%', maxWidth: 600, alignSelf: 'center', gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20 }}>{ui("rooms.review_rule_change")}</Text>
          <Text style={{ color: colors.text }}>{ui('common.config_update_help')}</Text>
          <ScrollView>{changes.map(([key, value]) => <Text key={key} style={{ color: colors.text, paddingVertical: 6 }}>{ruleFieldLabel(key)}: {show(old[key])} → {show(value)}</Text>)}</ScrollView>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{ui('common.config_updated')}</Text>
          {blocking && !proposal.can_vote && <Text style={{color:colors.text}}>{ui("rooms.proposal_waiting")}</Text>}
          {!!error && <Text activity accessibilityRole="alert" style={{color:colors.danger}}>{uiLabel(error, 'feedback')}</Text>}
          {!blocking && <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ padding: 12 }}><Text style={{ color: colors.accent }}>{ui("common.close_rule_review")}</Text></Pressable>}
        </View>
      </View>
    </Modal>
  </View>;
}
