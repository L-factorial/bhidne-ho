import { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardTable } from '../components/CardTable';
import { DealStatusPanel } from '../components/DealStatusPanel';
import { colors, fonts } from '../theme';
import { createTestDeal, stepTestDeal } from './autoplay';
import { BidPrompt } from './BidPrompt';

export function AutoPlayTable({ capacity, names, onExit }: { capacity: 4 | 5; names: string[]; onExit: () => void }) {
  const [deal, setDeal] = useState(() => createTestDeal(capacity));
  const [running, setRunning] = useState(false);
  const [bidding, setBidding] = useState(true);
  const [bidRound, setBidRound] = useState(0);
  const [bidMessage, setBidMessage] = useState('');
  const insets = useSafeAreaInsets();
  const width = Math.max(240, Math.min(useWindowDimensions().width - Math.max(insets.left, 12) - Math.max(insets.right, 12), 800));
  const viewer = Math.max(0, names.indexOf('You'));
  useEffect(() => {
    if (bidding || !running || deal.complete) return;
    const timer = setTimeout(() => setDeal(stepTestDeal), 3000);
    return () => clearTimeout(timer);
  }, [running, deal, bidding]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') setRunning(false); });
    return () => listener.remove();
  }, []);
  const players = deal.hands.map((hand, index) => ({ id: `seat-${index}`, name: index === viewer ? 'You' : names[index] || `Player ${index + 1}`,
    bid: deal.bids[index], tricks: deal.tricks[index], cardsRemaining: hand.length }));
  const label = (index: number) => players[index].name;
  return <ScrollView style={styles.page} contentContainerStyle={[styles.container, {
    paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24),
    paddingLeft: Math.max(insets.left, 12), paddingRight: Math.max(insets.right, 12),
  }]}><View style={{ width }}>
    <Pressable accessibilityRole="button" onPress={onExit} style={styles.button}><Text style={styles.buttonText}>Exit autoplay test</Text></Pressable>
    <Text accessibilityRole="header" style={styles.title}>Autoplay · testing only</Text>
    <Text style={styles.note}>One local deal · Choose your bid, then all seats play every 3 seconds. Suggested bids count aces and high spades.</Text>
    {bidding && <BidPrompt key={bidRound} suggested={deal.bids[viewer]} maximum={Math.floor(52 / capacity)} onConfirm={(amount, automatic) => {
      setDeal(value => ({ ...value, bids: value.bids.map((bid, index) => index === viewer ? amount : bid) }));
      setBidMessage(`${automatic ? 'Automatic' : 'Your'} bid confirmed: ${amount}`);
      setBidding(false); setRunning(true);
    }} />}
    {!!bidMessage && <Text accessibilityLiveRegion="polite" style={styles.note}>{bidMessage}</Text>}
    <View style={styles.controls}>
      <Pressable accessibilityRole="button" disabled={bidding || deal.complete} accessibilityState={{ disabled: bidding || deal.complete }}
        onPress={() => setRunning(value => !value)} style={[styles.button, (bidding || deal.complete) && { opacity: 0.4 }]}>
        <Text style={styles.buttonText}>{running && !deal.complete ? 'Pause autoplay' : 'Start autoplay'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={bidding || running || deal.complete} accessibilityState={{ disabled: bidding || running || deal.complete }}
        onPress={() => setDeal(stepTestDeal)} style={[styles.button, (bidding || running || deal.complete) && { opacity: 0.4 }]}><Text style={styles.buttonText}>Step once</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setRunning(false); setDeal(createTestDeal(capacity)); setBidding(true); setBidRound(value => value + 1); setBidMessage(''); }} style={styles.button}><Text style={styles.buttonText}>New test deal</Text></Pressable>
    </View>
    {!bidding && <DealStatusPanel players={players} viewerId={players[viewer].id} activePlayerId={deal.complete ? '' : players[deal.turn].id}
      cardsPlayed={deal.plays.length} paused={!running} trickNumber={deal.trick} complete={deal.complete} />}
    <Text accessibilityLiveRegion="polite" style={styles.status}>{bidding ? 'Bidding · waiting for your bid' : deal.complete ? 'Test deal complete — all cards played.' : deal.lastWinner !== null ? `${label(deal.lastWinner)} won trick ${deal.trick}` : `${label(deal.turn)} to play${running ? ' · autoplay running' : ' · paused'}`}</Text>
    <CardTable width={width} players={players} viewerId={players[viewer].id} pendingBidPlayerId={bidding ? players[viewer].id : undefined} activePlayerId={bidding ? players[viewer].id : deal.complete ? '' : players[deal.turn].id}
      plays={deal.plays.map(play => ({ playerId: players[play.player].id, card: play.card }))} />
    <Text style={styles.title}>Your hand · {deal.hands[viewer].length} cards</Text>
    <ScrollView horizontal contentContainerStyle={styles.hand} accessibilityLabel="Your automated test hand">
      {deal.hands[viewer].map(card => <View key={card} style={styles.card}><Text style={[styles.cardText, /[♥♦]/.test(card) && { color: '#A33332' }]}>{card}</Text></View>)}
    </ScrollView>
    <Text style={styles.note}>Local test simulation, separate from the Python engine. It follows suit, beats when required, and prefers low legal non-spades. No accounts, server actions, redeals, or match scoring. Opponent hands exist only in this disposable test simulator.</Text>
  </View></ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.navy }, container: { alignItems: 'center' }, title: { color: colors.ivory, fontFamily: fonts.display, fontSize: 28, marginVertical: 12 },
  note: { color: '#C1CBD5', fontFamily: fonts.body, fontSize: 11, lineHeight: 19 }, controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  button: { minHeight: 44, padding: 12, backgroundColor: colors.copper, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 12 },
  status: { color: colors.champagne, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center', marginTop: 18 },
  hand: { gap: 8, paddingVertical: 12 }, card: { width: 48, height: 68, borderRadius: 6, backgroundColor: colors.ivory, alignItems: 'center', justifyContent: 'center' }, cardText: { color: colors.ink, fontFamily: fonts.display, fontSize: 23 },
});
