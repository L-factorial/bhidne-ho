import {ActivityLine} from './ActivityLine';
import {AppText as Text} from './AppText';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {Pressable, View} from 'react-native';
import { marriageWinChoices, type MarriageWinChoice, type SeenMaal } from '../multiplayer/marriageFinishProgress';
import { physicalLabel, type MarriageCard, type MarriageMeld } from '../multiplayer/marriage';
import { MarriageMeldCards } from './MarriageMeldCards';
import { TurnGlow } from './TurnGlow';
import { visualStates, radii, fonts, gameButtonStyle, useTheme } from '../theme';

export function MarriageWinPanel({ hand, shown, initialTunnelas = [], maal, route, visible, enabled, busy, canFinish, preview, setPreview, error, submit, onEligibility, playerCount=4, hideIndicator=false }: {
  hideIndicator?:boolean; playerCount?:number; onEligibility?: (ready:boolean)=>void; hand: MarriageCard[]; shown: MarriageMeld[]; initialTunnelas?: MarriageMeld[]; maal: SeenMaal|null; route: string; visible: boolean; enabled: boolean;
  busy: boolean; canFinish: boolean; preview: boolean; setPreview: (value: boolean) => void; error: string;
  submit: (command: string, payload: object) => void;
}) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const key = JSON.stringify([hand.map(c => c.card_id).sort(), shown, maal, route, initialTunnelas,playerCount]);
  const [result, setResult] = useState<{ key: string; choices: MarriageWinChoice[] }>({ key: '', choices: [] });
  const [page, setPage] = useState(0);
  const touch = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!visible) return;
    const task = setTimeout(() => { setResult({ key, choices: marriageWinChoices(hand, shown, maal, route, initialTunnelas.flatMap(m => m.card_ids),playerCount) }); setPage(0); }, 0);
    return () => clearTimeout(task);
  }, [key, visible]);
  const checking = visible && (result.key !== key || busy);
  const choices = result.key === key && visible ? result.choices : [];
  const index = Math.min(page, Math.max(0, choices.length - 1)), choice = choices[index];
  const ready = !!choice, allowed = ready && enabled && canFinish && !checking;
  const canPreview = ready && !checking;
  useEffect(()=>{onEligibility?.(ready);},[ready,onEligibility]);
  const text = { color: c.text, fontFamily: fonts.body };
  const button = (label: string, onPress: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ ...gameButtonStyle(c, primary ? 'primary' : 'secondary', pressed), minHeight: 44, justifyContent: 'center', opacity: disabled ? visualStates.disabledOpacity : 1 })}><Text activity style={{ color: primary ? c.onPrimary : c.onTableHeader, fontFamily: fonts.medium }}>{label}</Text></Pressable>;
  if (!preview && (hideIndicator || !ready)) return null;
  if (!preview) {
    const label = ui(ready?"marriage.marriage_eligible":"marriage.marriage_ineligible");
    const hint = !visible ? ui("marriage.reveal_cards_to_check_marriage") : checking ? ui("marriage.checking_marriage") : ready ? allowed ? ui("marriage.marriage_eligible_show_marriage") : ui("marriage.marriage_eligible_view_options") : ui("marriage.marriage_not_eligible");
    return <View testID="marriage-win-eligibility" style={{ flex: 1, minHeight: 44, borderRadius: radii.medium, borderWidth: 1, borderColor: ready ? c.accent : c.border, backgroundColor: c.tableHeader, overflow: 'hidden' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled: !canPreview }} disabled={!canPreview} onPress={() => setPreview(true)} style={{ flex: 1, minHeight: 44, padding: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: canPreview ? 1 : visualStates.disabledOpacity }}>
        <Ionicons name={ready ? 'bulb' : 'bulb-outline'} size={16} color={ready ? c.accent : c.textMuted} />
        <Text activity accessibilityLiveRegion="polite" style={{ ...text, fontFamily: fonts.medium, fontSize: 11, color: ready ? c.accent : c.textMuted, textAlign: 'center', flexShrink: 1 }}>{label}</Text>
      </Pressable><TurnGlow active={canPreview} radius={12} />
    </View>;
  }
  const used = new Set(choice?.melds.flatMap(m => m.card_ids));
  const remaining = hand.filter(card => !used.has(card.card_id)&&card.card_id!==choice?.discard_card_id);
  return <View testID="marriage-win-preview" style={{ gap: 12 }}
    onTouchStart={e => { touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; }}
    onTouchEnd={e => { const dx = e.nativeEvent.pageX - touch.current.x, dy = e.nativeEvent.pageY - touch.current.y; if (!checking && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setPage(Math.max(0, Math.min(choices.length - 1, index + (dx < 0 ? 1 : -1)))); }}>
    {button(ui("common.back_to_your_cards"), () => setPreview(false))}
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui('marriage.previous_option')} disabled={checking||index===0} onPress={()=>setPage(index-1)} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center',opacity:index===0?.4:1}}><Ionicons name="chevron-back" size={16} color={c.accent}/></Pressable>
      <Text activity style={{...text,flex:1,textAlign:'center'}} accessibilityLiveRegion="polite">{checking?ui('marriage.checking_marriage'):ui('marriage.option_number_of_total',{number:choices.length?index+1:0,total:choices.length})}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={ui('marriage.next_option')} disabled={checking||index>=choices.length-1} onPress={()=>setPage(index+1)} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center',opacity:index>=choices.length-1?.4:1}}><Ionicons name="chevron-forward" size={16} color={c.accent}/></Pressable>
    </View>
    {choice && <><Text style={{ ...text, color: c.accent }}>{ui("marriage.your_winning_cards")}</Text><MarriageMeldCards groups={choice.melds} />
      {choice.discard_card_id ? <Text style={text}>{ui("marriage.final_discard_card", { "card": physicalLabel(choice.discard_card_id) })}</Text> : <><Text style={text}>{ui("marriage.remaining_in_your_hand_count_cards", { "count": remaining.length })}</Text><MarriageMeldCards groups={[{ meld_type: 'set', card_ids: remaining.map(c => c.card_id) }]} hideLabels /></>}
    </>}
    {!checking && !choice && <Text style={text}>{ui("marriage.your_hand_no_longer_qualifies_go_back_to_your_cards")}</Text>}
    {!!choice?.pairs&&<><Text style={text}>{ui("marriage.remaining_in_your_hand_count_cards",{count:remaining.length})}</Text><MarriageMeldCards groups={[{meld_type:'set',card_ids:remaining.map(c=>c.card_id)}]} hideLabels/></>}
    <Text style={{ ...text, color: c.textMuted }}>{ui(maal?"marriage.show_help":"marriage.unseen_finish_help")}</Text>
    {!!choice && !allowed && !checking && <Text style={{ ...text, color: c.textMuted }}>{ui("marriage.you_can_show_marriage_when_finishing_is_allowed_on_your_turn")}</Text>}
    {!!error && <Text activity accessibilityRole="alert" style={{ color: c.danger }}>{uiLabel(error, 'feedback')}</Text>}
    {busy&&<ActivityLine/>}
    {button(ui(maal?"marriage.show_marriage":"marriage.win_without_maal"), () => { if (allowed && choice) submit('FINISH', choice.pairs ? {pairs:choice.pairs,discard_card_id:choice.discard_card_id} : choice.winning_pair ? { winning_pair: choice.winning_pair } : { melds: choice.melds, discard_card_id: choice.discard_card_id }); }, !allowed, true)}
  </View>;
}
