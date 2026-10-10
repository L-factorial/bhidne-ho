import { CompactCardFace } from './CompactCardFace';
import { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from './AppText';
import { fonts, radii, useTheme } from '../theme';
import { ui } from '../i18n/copy';
import { summaryPlayers, summaryScore, summaryTotal } from '../multiplayer/callbreakSummary';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function CallBreakSummary({ snapshot, compact = false }: { snapshot: RoomSnapshot; compact?: boolean }) {
  const { colors: c } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(360);
  const trick = snapshot.game?.current_trick;
  const players = summaryPlayers(snapshot, compact ? trick?.plays[0]?.player_id ?? snapshot.game?.turn.player_id ?? undefined : snapshot.deal?.dealer, compact);
  const scale = snapshot.game?.score_scale ?? 10;
  const labelWidth = 80 * Math.max(1, fontScale);
  const minimumWidth = 56 * Math.max(1, fontScale);
  const columnWidth = Math.max(minimumWidth, Math.floor((availableWidth - labelWidth) / Math.max(1, players.length)));
  const currentWidth = Math.max(minimumWidth, Math.floor(availableWidth / Math.max(1, players.length)));
  const text = { color: c.text, fontFamily: fonts.medium, fontSize: compact ? 11 : 13 };
  const heading = (rounds: boolean) => <View style={{ flexDirection: 'row', backgroundColor: c.surfaceRaised }}>
    {rounds && <Text style={{ ...text, width: labelWidth, padding: 6 }}>{ui('callbreak.summary_round_label')}</Text>}
    {players.map(player => <Text key={player.player_id} numberOfLines={2} style={{ ...text, width: rounds ? columnWidth : currentWidth, textAlign: 'center', padding: 6 }}>{player.display_name || ui('common.player_number', { number: player.player_id })}</Text>)}
  </View>;
  // Fixed whole/fraction fields align the dot even for negative and two-digit scores.
  const score = (units: number | null, id: string) => {
    const absolute = Math.abs(units ?? 0), whole = Math.floor(absolute / scale), remainder = absolute % scale;
    return <View key={id} testID={`summary-score-${id}`} style={{ width: columnWidth, paddingVertical: 8, flexDirection: 'row', justifyContent: 'center' }}>
      <Text style={{ ...text, color: units !== null && units < 0 ? c.danger : c.text, width: 28 * Math.max(1, fontScale), textAlign: 'right', fontVariant: ['tabular-nums'] }}>{units === null ? '—' : `${units < 0 ? '−' : ''}${whole}`}</Text>
      <Text style={{ ...text, color: units !== null && units < 0 ? c.danger : c.text, width: 26 * Math.max(1, fontScale), fontVariant: ['tabular-nums'] }}>{units === null ? '' : `.${remainder}`}</Text>
    </View>;
  };
  const row = (label: string, round: number | 'subtotal' | 'final') => <View key={round} testID={`summary-round-${round}`} style={{ flexDirection: 'row', borderTopWidth: typeof round === 'string' || round === 5 ? 2 : 1, borderColor: c.border }}>
    <Text style={{ ...text, width: labelWidth, padding: 6 }}>{label}</Text>
    {players.map(player => score(typeof round === 'number' ? summaryScore(snapshot, player.player_id, round) : summaryTotal(snapshot, player.player_id, round === 'final'), `${round}-${player.player_id}`))}
  </View>;
  return <View testID={compact ? 'callbreak-hand-trick-summary' : 'callbreak-summary'} onLayout={event => { if (event.nativeEvent.layout.width > 0) setAvailableWidth(event.nativeEvent.layout.width); }} style={{ gap: compact ? 4 : 12 }}>
    {!compact && <View style={{ padding: 12, borderRadius: radii.medium, backgroundColor: c.surfaceRaised, gap: 4 }}>
      <Text style={text}>{ui('callbreak.summary_dealer', { player: players.find(player => player.player_id === snapshot.deal?.dealer)?.display_name || '—' })}</Text>
      <Text style={text}>{ui('callbreak.summary_round', { round: snapshot.deal?.deal_number ?? '—', total: 5 })}</Text>
    </View>}
    {!compact && <Text style={text}>{ui('callbreak.summary_bid_won')}</Text>}
    <ScrollView horizontal nestedScrollEnabled><View>
      {heading(false)}
      <View style={{ flexDirection: 'row' }}>{players.map(player => {
        const bid = snapshot.deal?.players.find(row => row.player_id === player.player_id);
        return <Text key={player.player_id} style={{ ...text, width: currentWidth, textAlign: 'center', paddingVertical: 6 }}>{bid?.bid ?? '—'} / {bid?.tricks_won ?? 0}</Text>;
      })}</View>
      {compact && <View style={{ flexDirection: 'row' }}>{players.map(player => {
        const play = trick?.plays.find(play => play.player_id === player.player_id);
        return <View key={player.player_id} style={{ width: currentWidth, alignItems: 'center', padding: 3 }}><View testID={`hand-trick-${player.player_id}`} accessibilityLabel={play?.card} style={{width:44,height:64,borderWidth:2,borderRadius:6,overflow:'hidden',alignItems:'center',justifyContent:'center',backgroundColor:play?c.cardFace:c.surface,borderColor:play&&play===trick?.plays[0]?c.accent:c.border}}>
          {play?<CompactCardFace compact rank={play.card.slice(0,-1)} suit={play.card.slice(-1)}/>:<Text style={text}>—</Text>}
        </View></View>;
      })}</View>}
    </View></ScrollView>
    {!compact && <ScrollView horizontal nestedScrollEnabled><View>
      {heading(true)}
      {[1, 2, 3, 4].map(round => row(String(round), round))}
      {row(ui('callbreak.summary_subtotal'), 'subtotal')}
      {row('5', 5)}
      {row(ui('callbreak.summary_final'), 'final')}
    </View></ScrollView>}
  </View>;
}
