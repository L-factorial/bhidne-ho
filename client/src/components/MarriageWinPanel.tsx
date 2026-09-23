import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { marriageWinChoices, type MarriageWinChoice, type SeenMaal } from '../multiplayer/marriageFinishProgress';
import { physicalLabel, type MarriageCard, type MarriageMeld } from '../multiplayer/marriage';
import { MarriageMeldCards } from './MarriageMeldCards';
import { TurnGlow } from './TurnGlow';
import { fonts, gameButtonStyle, useTheme } from '../theme';

export function MarriageWinPanel({ hand, shown, maal, route, visible, enabled, busy, canFinish, preview, setPreview, error, submit }: {
  hand: MarriageCard[]; shown: MarriageMeld[]; maal: SeenMaal; route: string; visible: boolean; enabled: boolean;
  busy: boolean; canFinish: boolean; preview: boolean; setPreview: (value: boolean) => void; error: string;
  submit: (command: string, payload: object) => void;
}) {
  const { colors: c } = useTheme();
  const key = JSON.stringify([hand.map(c => c.card_id).sort(), shown, maal, route]);
  const [result, setResult] = useState<{ key: string; choices: MarriageWinChoice[] }>({ key: '', choices: [] });
  const [page, setPage] = useState(0);
  const touch = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!visible) return;
    const task = setTimeout(() => { setResult({ key, choices: marriageWinChoices(hand, shown, maal, route) }); setPage(0); }, 0);
    return () => clearTimeout(task);
  }, [key, visible]);
  const checking = visible && (result.key !== key || busy);
  const choices = result.key === key && visible ? result.choices : [];
  const index = Math.min(page, Math.max(0, choices.length - 1)), choice = choices[index];
  const ready = !!choice, allowed = ready && enabled && canFinish && !checking;
  const canPreview = ready && !checking;
  const text = { color: c.text, fontFamily: fonts.body };
  const button = (label: string, onPress: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ ...gameButtonStyle(c, primary ? 'primary' : 'secondary', pressed), minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.45 : 1 })}><Text style={{ color: primary ? c.onPrimary : c.onTableHeader, fontFamily: fonts.medium }}>{label}</Text></Pressable>;
  if (!preview) {
    const label = !visible ? 'Reveal cards to check Marriage' : checking ? 'Checking Marriage…' : ready ? allowed ? 'Marriage eligible · Show Marriage' : 'Marriage eligible · View options' : 'Marriage not eligible';
    return <View testID="marriage-win-eligibility" style={{ borderRadius: 12, borderWidth: 1, borderColor: ready ? c.accent : c.border, overflow: 'hidden' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !canPreview }} disabled={!canPreview} onPress={() => setPreview(true)} style={{ minHeight: 48, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: ready ? 1 : 0.5 }}>
        <Ionicons name={ready ? 'bulb' : 'bulb-outline'} size={22} color={ready ? c.accent : c.textMuted} />
        <Text accessibilityLiveRegion="polite" style={{ ...text, color: ready ? c.accent : c.textMuted, flexShrink: 1 }}>{label}</Text>
      </Pressable><TurnGlow active={canPreview} radius={12} />
    </View>;
  }
  const used = new Set(choice?.melds.flatMap(m => m.card_ids));
  const remaining = hand.filter(card => !used.has(card.card_id));
  return <View testID="marriage-win-preview" style={{ gap: 12 }}
    onTouchStart={e => { touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; }}
    onTouchEnd={e => { const dx = e.nativeEvent.pageX - touch.current.x, dy = e.nativeEvent.pageY - touch.current.y; if (!checking && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setPage(Math.max(0, Math.min(choices.length - 1, index + (dx < 0 ? 1 : -1)))); }}>
    {button('Back to your cards', () => setPreview(false))}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      {button('Previous option', () => setPage(index - 1), checking || index === 0)}
      <Text style={text} accessibilityLiveRegion="polite">{checking ? 'Checking Marriage…' : `Option ${choices.length ? index + 1 : 0} of ${choices.length}`}</Text>
      {button('Next option', () => setPage(index + 1), checking || index >= choices.length - 1)}
    </View>
    {choice && <><Text style={{ ...text, color: c.accent }}>Your winning cards</Text><MarriageMeldCards groups={choice.melds} />
      {choice.discard_card_id ? <Text style={text}>Final discard: {physicalLabel(choice.discard_card_id)}</Text> : <><Text style={text}>Remaining in your hand · {remaining.length} cards</Text><MarriageMeldCards groups={[{ meld_type: 'set', card_ids: remaining.map(c => c.card_id) }]} hideLabels /></>}
    </>}
    {!checking && !choice && <Text style={text}>Your hand no longer qualifies. Go back to your cards.</Text>}
    <Text style={{ ...text, color: c.textMuted }}>Showing Marriage reveals your winning cards to everyone at the table.</Text>
    {!!choice && !allowed && !checking && <Text style={{ ...text, color: c.textMuted }}>You can show Marriage when finishing is allowed on your turn.</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text>}
    {button(busy ? 'Showing…' : 'Show Marriage', () => { if (allowed && choice) submit('FINISH', choice.winning_pair ? { winning_pair: choice.winning_pair } : { melds: choice.melds, discard_card_id: choice.discard_card_id }); }, !allowed, true)}
  </View>;
}
