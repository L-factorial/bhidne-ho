import { phaseLabel } from '../i18n/display';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { ActionCue } from './ActionCue';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fonts, primaryAction, useTheme } from '../theme';

export type TableView = {
  table_id: string; phase: 'OPEN' | 'LOCKED' | 'STARTED' | 'COMPLETED' | 'ENDED';
  min_players: number; max_players: number; requires_explicit_lock: boolean; requires_replacement: boolean;
  seated_players: { seat_id: number; user_id: string; display_name?: string }[]; queue: string[];
  released_seats: { seat_id: number; leaving_player_id: string }[];
  current_user: { is_seated: boolean; seat_id: number | null; is_queued: boolean; queue_position: number | null;
    can_join: boolean; can_queue: boolean; can_lock: boolean; can_start: boolean; can_next_match: boolean;
    can_leave_seat: boolean; can_abandon_match: boolean; can_invite_replacement: boolean;
    replacement_offer: { offer_id: string; seat_id: number; expires_at: number } | null };
};

export function TableControls({ table, members, userId, busy, act, start, formationBlocked = false, menuSection }: {
  menuSection?: 'manage' | 'leave'; table: TableView; members: string[]; userId: string; busy: boolean; formationBlocked?: boolean;
  act: (command: string, payload?: object) => Promise<void>; start: () => Promise<void>;
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const [abandon, setAbandon] = useState(false), [invite, setInvite] = useState(false);
  const manage = menuSection !== 'leave', leave = menuSection !== 'manage';
  const me = table.current_user, offer = me.replacement_offer;
  const button = (label: string, action: () => void, disabled = false, prominent = false, pulse = false, danger = false) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} disabled={busy || disabled} onPress={action}
    style={({ pressed }) => [{ padding: 10, minHeight: 44, borderRadius: 8, justifyContent: 'center', opacity: busy || disabled ? 0.45 : 1 }, prominent && primaryAction(colors, pressed)]}>
    {pulse ? <ActionCue active={!busy && !disabled} style={{ color: colors.onPrimary, fontFamily: fonts.medium }}>{label}</ActionCue> : <Text style={{ color: menuSection === 'leave' || danger ? colors.danger : prominent ? colors.onPrimary : colors.text, fontFamily: fonts.medium }}>{label}</Text>}
  </Pressable>;
  return <View testID="table-lifecycle" style={{ backgroundColor: colors.surface, padding: 8, gap: 4 }}>
    {!menuSection && <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>
      {table.phase === 'COMPLETED' ? ui("rooms.match_completed_seats_for_the_next_match") : table.phase === 'LOCKED' ? ui("rooms.roster_locked_ready_to_start") : ui("rooms.seat_summary", { "seated": table.seated_players.length, "capacity": table.max_players, "phase": phaseLabel(table.phase) })}
      {me.is_seated ? ui("rooms.your_seat", { "seat": me.seat_id }) : me.is_queued ? ui("rooms.queue_suffix", { "position": me.queue_position }) : ui("rooms.observing_suffix")}
      {table.queue.length > 0 && !me.is_queued ? ui("rooms.waiting_suffix", { "count": table.queue.length }) : ''}
    </Text>}
    {manage && table.phase === 'COMPLETED' && <Text style={{ color: colors.text }}>{table.seated_players.map(p => ui("rooms.seat_seat_player", { "seat": p.seat_id, "player": p.display_name || p.user_id })).join(' · ')}</Text>}
    {manage && !!table.released_seats.length && <Text style={{ color: colors.textMuted }}>{ui("rooms.waiting_replacements", { "count": table.released_seats.length, "suffix": table.released_seats.length === 1 ? '' : 's' })}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {manage && me.can_queue && !me.can_join && button(ui("rooms.join_waitlist"), () => void act('join-queue'))}
      {manage && me.is_queued && button(ui("rooms.leave_waitlist"), () => void act('leave-queue'))}
      {manage && table.requires_explicit_lock && table.phase === 'OPEN' && button(ui("rooms.lock_game"), () => void act('lock'), !me.can_lock || formationBlocked, true, true)}
      {manage && table.requires_explicit_lock && table.phase === 'LOCKED' && button(ui("rooms.start_game"), () => void start(), !me.can_start || formationBlocked, true, true)}
      {leave && me.can_leave_seat && button(menuSection ? ui("rooms.leave_table") : ui("rooms.leave_seat"), () => void act('leave-seat'))}
      {manage && me.can_next_match && button(ui("rooms.prepare_next_match"), () => void act('next-match'), false, true)}
      {leave && me.can_abandon_match && button(menuSection ? ui("rooms.leave_table") : ui("rooms.abandon_match"), () => setAbandon(true))}
      {manage && me.can_invite_replacement && button(ui("rooms.invite_a_replacement"), () => setInvite(v => !v))}
    </View>
    {manage && formationBlocked && <Text style={{ color: colors.text }}>{ui("rooms.save_rules_first")}</Text>}
    {manage && offer && <View>
      <Text style={{ color: colors.text }}>{ui("rooms.seat_seat_is_offered_to_you_for_the_next_match", { "seat": offer.seat_id })}</Text>
      <View style={{ flexDirection: 'row' }}>
        {button(ui("rooms.accept_seat"), () => void act('accept-seat', { offer_id: offer.offer_id }), false, true)}
        {button(ui("rooms.decline_seat"), () => void act('decline-seat', { offer_id: offer.offer_id }))}
      </View>
    </View>}
    {abandon && me.can_abandon_match && <View>
      <Text style={{ color: colors.text }}>Abandon this active match? It will stop for everyone. No penalty is currently applied.</Text>
      {button(ui("rooms.confirm_abandon_match"), () => { setAbandon(false); void act('abandon'); }, false, false, false, true)}
      {button(ui("common.keep_playing"), () => setAbandon(false))}
    </View>}
    {invite && me.can_invite_replacement && <View>
      {table.released_seats.map(seat => <View key={seat.seat_id}>
        <Text style={{ color: colors.text }}>{ui("rooms.ask_someone_to_take_seat_seat", { "seat": seat.seat_id })}</Text>
        {members.filter(user => !table.seated_players.some(p => p.user_id === user) && user !== userId).map(user =>
          <View key={user}>{button(ui("rooms.invite_player", { "player": user }), () => void act('invite-seat', { seat_id: seat.seat_id, recipient: user }))}</View>)}
      </View>)}
    </View>}
  </View>;
}
