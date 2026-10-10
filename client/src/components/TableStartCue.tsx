import {AppText as Text} from './AppText';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import {View} from 'react-native';
import { FloatingTableAction } from './FloatingTableAction';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { radii, fonts, useTheme } from '../theme';

export function TableStartCue({ snapshot, busy, onStart, onTableAction, onNewGame }: {
  snapshot: RoomSnapshot; busy: boolean; onStart: () => void; onTableAction: (command: string) => void; onNewGame: () => void;
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const table = snapshot.table, me = table?.current_user;
  const next = table?.phase === 'COMPLETED';
  const finished = snapshot.status === 'finished';
  const host = table ? !!me?.is_seated && table.seated_players[0]?.seat_id === me.seat_id : snapshot.is_creator;
  const seatCount = table?.seated_players.length ?? snapshot.players?.length ?? 0;
  const visible = (snapshot.status === 'waiting' || finished || table?.phase === 'OPEN' || table?.phase === 'LOCKED' || next);
  if (!visible) return null;
  const allowed = table ? (next ? me?.can_next_match && seatCount >= table.min_players : me?.can_start) : (finished || snapshot.ready);
  const disabled = busy || !allowed || snapshot.rule_proposal?.status === 'PENDING';
  const label = snapshot.starting ? ui("rooms.starting_game") : next || finished ? ui("rooms.play_again") : ui("rooms.start_game");
  return <View testID={`${snapshot.game_type}-center-start`} style={{ alignItems: 'center', justifyContent: 'center', minHeight: 120, padding: 12, gap: 8, backgroundColor: 'transparent', borderRadius: radii.large }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium, textAlign: 'center' }}>{table?.phase === 'LOCKED' ? ui("rooms.players_locked") : finished ? ui("rooms.ready_for_another_round") : ui("rooms.waiting_for_players")}</Text>
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{ui("rooms.seated_of_capacity_seated", { "seated": seatCount, "capacity": table?.max_players || snapshot.capacity })}</Text>
    {host ? <FloatingTableAction label={label} loading={snapshot.starting} disabled={disabled}
      onPress={() => next ? onTableAction('next-match') : finished && !table ? onNewGame() : onStart()} /> : <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{ui('rooms.waiting_for_creator_to_start', { player: snapshot.players?.find(p => p.user_id === table?.seated_players[0]?.user_id)?.display_name || ui('rooms.host') })}</Text>}
    {host && !allowed && <Text style={{ color: colors.textMuted, fontFamily: fonts.body, textAlign: 'center' }}>{(seatCount) < (table?.min_players || snapshot.capacity || 2) ? ui("rooms.waiting_for_more_players", { "count": (table?.min_players || snapshot.capacity || 2) - seatCount }) : ui("common.waiting_for_eligible_seats_and_rule_approval")}</Text>}
  </View>;
}
