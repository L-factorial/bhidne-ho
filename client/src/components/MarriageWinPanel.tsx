import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { marriageWinChoices, type MarriageWinChoice, type SeenMaal } from '../multiplayer/marriageFinishProgress';
import { physicalLabel, type MarriageCard, type MarriageMeld } from '../multiplayer/marriage';
import { MarriageMeldCards } from './MarriageMeldCards';
import { TurnGlow } from './TurnGlow';
import { fonts, gameButtonStyle, useTheme } from '../theme';

export function MarriageWinPanel({ hand, shown, initialTunnelas = [], maal, route, visible, enabled, busy, canFinish, preview, setPreview, error, submit }: {
  hand: MarriageCard[]; shown: MarriageMeld[]; initialTunnelas?: MarriageMeld[]; maal: SeenMaal; route: string; visible: boolean; enabled: boolean;
  busy: boolean; canFinish: boolean; preview: boolean; setPreview: (value: boolean) => void; error: string;
  submit: (command: string, payload: object) => void;
}) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const key = JSON.stringify([hand.map(c => c.card_id).sort(), shown, maal, route, initialTunnelas]);
  const [result, setResult] = useState<{ key: string; choices: MarriageWinChoice[] }>({ key: '', choices: [] });
  const [page, setPage] = useState(0);
  const touch = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!visible) return;
    const task = setTimeout(() => { setResult({ key, choices: marriageWinChoices(hand, shown, maal, route, initialTunnelas.flatMap(m => m.card_ids)) }); setPage(0); }, 0);
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
    const label = !visible ? ui("marriage.reveal_cards_to_check_marriage") : checking ? ui("marriage.checking_marriage") : ready ? allowed ? ui("marriage.marriage_eligible_show_marriage") : ui("marriage.marriage_eligible_view_options") : ui("marriage.marriage_not_eligible");
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
    {button(ui("common.back_to_your_cards"), () => setPreview(false))}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      {button(ui("marriage.previous_option"), () => setPage(index - 1), checking || index === 0)}
      <Text style={text} accessibilityLiveRegion="polite">{checking ? ui("marriage.checking_marriage") : ui("marriage.option_number_of_total", { "number": choices.length ? index + 1 : 0, "total": choices.length })}</Text>
      {button(ui("marriage.next_option"), () => setPage(index + 1), checking || index >= choices.length - 1)}
    </View>
    {choice && <><Text style={{ ...text, color: c.accent }}>{ui("marriage.your_winning_cards")}</Text><MarriageMeldCards groups={choice.melds} />
      {choice.discard_card_id ? <Text style={text}>{ui("marriage.final_discard_card", { "card": physicalLabel(choice.discard_card_id) })}</Text> : <><Text style={text}>{ui("marriage.remaining_in_your_hand_count_cards", { "count": remaining.length })}</Text><MarriageMeldCards groups={[{ meld_type: 'set', card_ids: remaining.map(c => c.card_id) }]} hideLabels /></>}
    </>}
    {!checking && !choice && <Text style={text}>{ui("marriage.your_hand_no_longer_qualifies_go_back_to_your_cards")}</Text>}
    <Text style={{ ...text, color: c.textMuted }}>Showing Marriage reveals your winning cards to everyone at the table.</Text>
    {!!choice && !allowed && !checking && <Text style={{ ...text, color: c.textMuted }}>{ui("marriage.you_can_show_marriage_when_finishing_is_allowed_on_your_turn")}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text>}
    {button(busy ? 'Showing…' : ui("marriage.show_marriage"), () => { if (allowed && choice) submit('FINISH', choice.winning_pair ? { winning_pair: choice.winning_pair } : { melds: choice.melds, discard_card_id: choice.discard_card_id }); }, !allowed, true)}
  </View>;
}
