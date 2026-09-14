import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../theme';

export type RuleProposalView = {
  id: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED'; proposer_name: string;
  voters: string[]; accepted: string[]; can_vote: boolean;
  previous: Record<string, unknown>; proposed: Record<string, unknown>;
};
const flatten = (value: Record<string, unknown>, prefix = ''): [string, unknown][] => Object.entries(value).flatMap(([key, item]) =>
  item && typeof item === 'object' && !Array.isArray(item) ? flatten(item as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, item]]);
const label = (key: string) => key.replace(/^rules\./, '').replaceAll('_', ' ');
const show = (value: unknown) => typeof value === 'boolean' ? value ? 'Yes' : 'No' : JSON.stringify(value);
export function RuleProposal({ proposal, busy, vote }: { proposal: RuleProposalView; busy: boolean; vote: (accept: boolean) => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const old = Object.fromEntries(flatten(proposal.previous));
  const changes = flatten(proposal.proposed).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(old[key]));
  return <View style={{ padding: 10, backgroundColor: colors.surface }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Review rule change" onPress={() => setOpen(true)}>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.accent }}>{proposal.proposer_name} proposed rule changes · {proposal.status.toLowerCase()}{proposal.status === 'PENDING' ? ` · ${proposal.accepted.length}/${proposal.voters.length} accepted` : ''} · Review</Text>
    </Pressable>
    <Modal transparent visible={open} onRequestClose={() => setOpen(false)} animationType="fade">
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 16, maxHeight: '85%', width: '100%', maxWidth: 600, alignSelf: 'center', gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20 }}>Review rule change</Text>
          <Text style={{ color: colors.text }}>Every seated player must accept. A rejection keeps the existing rules. Viewers can review but cannot vote.</Text>
          <ScrollView>{changes.map(([key, value]) => <Text key={key} style={{ color: colors.text, paddingVertical: 6 }}>{label(key)}: {show(old[key])} → {show(value)}</Text>)}</ScrollView>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{proposal.status.toLowerCase()} · {proposal.accepted.length}/{proposal.voters.length} accepted</Text>
          {proposal.can_vote && <View style={{ flexDirection: 'row', gap: 20 }}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => vote(true)} style={{ padding: 12 }}><Text style={{ color: colors.accent }}>Accept rules</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => vote(false)} style={{ padding: 12 }}><Text style={{ color: colors.danger }}>Reject rules</Text></Pressable>
          </View>}
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ padding: 12 }}><Text style={{ color: colors.accent }}>Close rule review</Text></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}
