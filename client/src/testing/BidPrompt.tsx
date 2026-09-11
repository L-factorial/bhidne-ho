import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export function BidPrompt({ suggested, maximum, onConfirm }: {
  suggested: number; maximum: number; onConfirm: (amount: number, automatic: boolean) => void;
}) {
  const [amount, setAmount] = useState(suggested);
  const [seconds, setSeconds] = useState(10);
  const committed = useRef(false);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;
  const deadline = useRef<number | null>(null);
  function confirm(value: number, automatic: boolean) {
    if (committed.current) return;
    committed.current = true;
    // A late manual press must not replace a bid whose deadline has passed.
    const expired = deadline.current !== null && performance.now() >= deadline.current;
    confirmRef.current(expired ? suggested : value, automatic || expired);
  }
  useEffect(() => {
    deadline.current = performance.now() + 10000;
    const countdown = setInterval(() => setSeconds(Math.max(0, Math.ceil(((deadline.current ?? 0) - performance.now()) / 1000))), 100);
    const fallback = setTimeout(() => confirm(suggested, true), 10000);
    return () => { clearInterval(countdown); clearTimeout(fallback); };
  }, []);
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.heading}>Your bid · Deal 1</Text>
    <Text style={styles.text}>Suggested bid: {suggested}. Review your hand and choose how many tricks you’ll win.</Text>
    <Text testID="bid-countdown" style={styles.text}>Auto bid {suggested} in {seconds}s</Text>
    <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel="Decrease bid" disabled={amount <= 1}
        accessibilityState={{ disabled: amount <= 1 }} onPress={() => setAmount(value => Math.max(1, value - 1))} style={styles.button}><Text style={styles.buttonText}>−</Text></Pressable>
      <Text accessibilityLabel={`Selected bid ${amount}`} style={styles.amount}>{amount}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Increase bid" disabled={amount >= maximum}
        accessibilityState={{ disabled: amount >= maximum }} onPress={() => setAmount(value => Math.min(maximum, value + 1))} style={styles.button}><Text style={styles.buttonText}>+</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Confirm bid" onPress={() => confirm(amount, false)} style={styles.button}><Text style={styles.buttonText}>Confirm bid</Text></Pressable>
    </View>
    <Text style={styles.text}>If you don’t confirm within 10 seconds, the suggested bid is used.</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: 16, borderWidth: 1, borderColor: colors.champagne, borderRadius: 12, marginTop: 16 }, heading: { fontFamily: fonts.display, fontSize: 26, color: colors.ivory },
  text: { fontFamily: fonts.body, fontSize: 12, lineHeight: 21, color: colors.champagne, marginTop: 8 }, controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 14 },
  button: { minHeight: 44, minWidth: 44, padding: 12, borderRadius: 8, backgroundColor: colors.copper, justifyContent: 'center', alignItems: 'center' }, buttonText: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 12 }, amount: { minWidth: 32, textAlign: 'center', color: colors.ivory, fontFamily: fonts.display, fontSize: 30 },
});
