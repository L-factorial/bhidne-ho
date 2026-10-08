import { Pressable, View } from 'react-native';
import { AppText as Text } from './AppText';
import { CardBack } from './CardBack';
import { CompactCardFace } from './CompactCardFace';
import { PlayerSeat } from './PlayerSeat';
import { TableSeatLayout } from './TableSeatLayout';
import { useTheme, fonts } from '../theme';
import { ui } from '../i18n/copy';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function DealerSelectionTable({ snapshot, busy, onPick }: {
  snapshot: RoomSnapshot; busy: boolean; onPick: (position: number) => void;
}) {
  const { colors: c } = useTheme();
  const selection = snapshot.game!.dealer_selection!;
  const players = (snapshot.players || []).map(p => ({ ...p, id: String(p.player_id) }));
  const mine = snapshot.your_player_id === selection.current_player;
  const actor = players.find(p => p.player_id === selection.current_player);
  return <View testID="callbreak-dealer-selection" style={{ gap: 12, alignItems: 'center' }}>
    <Text style={{ fontFamily: fonts.display, fontSize: 22 }}>{ui('callbreak.choose_first_dealer')}</Text>
    <Text style={{ color: c.textMuted, textAlign: 'center', maxWidth: 600 }}>{ui('callbreak.dealer_draw_rules')}</Text>
    <TableSeatLayout players={players} viewerId={String(snapshot.your_player_id)} renderSeat={player => {
      const pick = selection.picks.find(p => p.player_id === player.player_id);
      return <View style={{ alignItems: 'center', gap: 4 }}>
        <PlayerSeat playerId={player.player_id} name={player.display_name || ui('common.player_number', { number: player.player_id })}
          mine={player.player_id === snapshot.your_player_id} active={player.player_id === selection.current_player}
          avatarUrl={player.avatar_url} connected={player.connected} compact />
        {pick && <View testID={`dealer-pick-${player.player_id}`} accessibilityLabel={pick.card}
          style={{ width: 44, height: 62, backgroundColor: c.cardFace, borderColor: c.cardBorder, borderWidth: 1, borderRadius: 5, justifyContent: 'center' }}>
          <CompactCardFace rank={pick.card.slice(0, -1)} suit={pick.card.slice(-1)} compact />
        </View>}
      </View>;
    }}>
      <Text accessibilityLiveRegion="polite" style={{ textAlign: 'center', color: c.text, fontFamily: fonts.medium }}>
        {mine ? ui('callbreak.your_dealer_pick') : ui('callbreak.waiting_dealer_pick', { player: actor?.display_name || ui('common.player_number', { number: selection.current_player }) })}
      </Text>
    </TableSeatLayout>
    <View testID="dealer-selection-deck" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 5, maxWidth: 650, width: '100%' }}>
      {selection.available_positions.map(position => <Pressable key={position} testID={`dealer-card-${position}`}
        accessibilityRole="button" accessibilityLabel={ui('callbreak.pick_dealer_card', { number: position + 1 })}
        disabled={!mine || busy} accessibilityState={{ disabled: !mine || busy }} onPress={() => onPick(position)}
        style={{ width: 44, height: 65, borderRadius: 5, opacity: busy ? 0.6 : 1 }}><CardBack /></Pressable>)}
    </View>
  </View>;
}
