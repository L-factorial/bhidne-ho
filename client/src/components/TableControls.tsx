import { ActionCue } from './ActionCue';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

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
  const { colors } = useTheme();
  const [abandon, setAbandon] = useState(false), [invite, setInvite] = useState(false);
  const manage = menuSection !== 'leave', leave = menuSection !== 'manage';
  const me = table.current_user, offer = me.replacement_offer;
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} disabled={busy || disabled} onPress={action}
    style={{ padding: 10, minHeight: 44, justifyContent: 'center', opacity: busy || disabled ? 0.45 : 1 }}>
    {['Lock game', 'Start game'].includes(label) ? <ActionCue active={!busy && !disabled} style={{ color: colors.accent, fontFamily: fonts.medium }}>{label}</ActionCue> : <Text style={{ color: menuSection === 'leave' ? colors.danger : colors.accent, fontFamily: fonts.medium }}>{label}</Text>}
  </Pressable>;
  return <View testID="table-lifecycle" style={{ backgroundColor: colors.surface, padding: 8, gap: 4 }}>
    {!menuSection && <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>
      {table.phase === 'COMPLETED' ? 'Match completed · seats for the next match' : table.phase === 'LOCKED' ? 'Roster locked · ready to start' : `${table.seated_players.length}/${table.max_players} seated · ${table.phase.toLowerCase()}`}
      {me.is_seated ? ` · Your seat ${me.seat_id}` : me.is_queued ? ` · Waitlist position ${me.queue_position}` : ' · Observing'}
      {table.queue.length > 0 && !me.is_queued ? ` · ${table.queue.length} waiting` : ''}
    </Text>}
    {manage && table.phase === 'COMPLETED' && <Text style={{ color: colors.text }}>{table.seated_players.map(p => `Seat ${p.seat_id}: ${p.display_name || p.user_id}`).join(' · ')}</Text>}
    {manage && !!table.released_seats.length && <Text style={{ color: colors.textMuted }}>Waiting for {table.released_seats.length} replacement seat{table.released_seats.length === 1 ? '' : 's'} to be accepted.</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {manage && me.can_queue && !me.can_join && button('Join waitlist', () => void act('join-queue'))}
      {manage && me.is_queued && button('Leave waitlist', () => void act('leave-queue'))}
      {manage && table.requires_explicit_lock && table.phase === 'OPEN' && button('Lock game', () => void act('lock'), !me.can_lock || formationBlocked)}
      {manage && table.requires_explicit_lock && table.phase === 'LOCKED' && button('Start game', () => void start(), !me.can_start || formationBlocked)}
      {leave && me.can_leave_seat && button(menuSection ? 'Leave Table' : 'Leave Seat', () => void act('leave-seat'))}
      {manage && me.can_next_match && button('Prepare next match', () => void act('next-match'))}
      {leave && me.can_abandon_match && button(menuSection ? 'Leave Table' : 'Abandon match', () => setAbandon(true))}
      {manage && me.can_invite_replacement && button('Invite a replacement', () => setInvite(v => !v))}
    </View>
    {manage && formationBlocked && <Text style={{ color: colors.text }}>Save or reload your rule changes before locking or starting.</Text>}
    {manage && offer && <View>
      <Text style={{ color: colors.text }}>Seat {offer.seat_id} is offered to you for the next match.</Text>
      <View style={{ flexDirection: 'row' }}>
        {button('Accept seat', () => void act('accept-seat', { offer_id: offer.offer_id }))}
        {button('Decline seat', () => void act('decline-seat', { offer_id: offer.offer_id }))}
      </View>
    </View>}
    {abandon && me.can_abandon_match && <View>
      <Text style={{ color: colors.text }}>Abandon this active match? It will stop for everyone. No penalty is currently applied.</Text>
      {button('Confirm abandon match', () => { setAbandon(false); void act('abandon'); })}
      {button('Keep playing', () => setAbandon(false))}
    </View>}
    {invite && me.can_invite_replacement && <View>
      {table.released_seats.map(seat => <View key={seat.seat_id}>
        <Text style={{ color: colors.text }}>Ask someone to take seat {seat.seat_id}</Text>
        {members.filter(user => !table.seated_players.some(p => p.user_id === user) && user !== userId).map(user =>
          <View key={user}>{button(`Invite ${user}`, () => void act('invite-seat', { seat_id: seat.seat_id, recipient: user }))}</View>)}
      </View>)}
    </View>}
  </View>;
}
