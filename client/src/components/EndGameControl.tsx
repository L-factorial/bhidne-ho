import {AppText as Text} from './AppText';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { RoomSheet } from './RoomSheet';
import { useState } from 'react';
import {Pressable, View} from 'react-native';
import { visualStates, radii, fonts, useTheme } from '../theme';

export function EndGameControl({ busy, onEnd, compact = false, table = false }: { table?: boolean; compact?: boolean; busy: boolean; onEnd: () => Promise<void> }) {
  useUiLanguage();
  const { colors } = useTheme();
  const label = table ? ui("rooms.end_table") : ui("rooms.end_game");
  const confirmation = table ? ui("common.confirm_end_table_help") : ui("common.confirm_end_game_help");
  const [confirming, setConfirming] = useState(false);
  function confirmEnd() {
    setConfirming(false);
    void onEnd();
  }
  const button = (label: string, onPress: () => void) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress}
    style={{ minHeight: 44, padding: 12, justifyContent: 'center', opacity: busy ? visualStates.disabledOpacity : 1 }}>
    <Text style={{ color: colors.accent, fontFamily: fonts.medium }}>{label}</Text>
  </Pressable>;
  if (compact) return <View>
    {button(label, () => setConfirming(true))}
    <RoomSheet visible={confirming} presentation="dialog" title={table ? ui("rooms.end_this_table") : ui("rooms.end_this_game")} closeLabel={ui("rooms.cancel_ending_table")} onClose={() => setConfirming(false)}>
      <Text accessibilityRole="alert" style={{ color: colors.text, fontFamily: fonts.body }}>{confirmation}</Text>
      {button(ui("common.keep_playing"), () => setConfirming(false))}
      {button(ui("common.action_everyone", { "action": label }), confirmEnd)}
    </RoomSheet>
  </View>;
  return <View style={{ backgroundColor: colors.surface, paddingHorizontal: 12, borderRadius: radii.medium }}>
    {confirming ? <>
      <Text accessibilityRole="alert" style={{ color: colors.text, paddingTop: 12, fontFamily: fonts.body }}>
        {confirmation}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {button(ui("common.keep_playing"), () => setConfirming(false))}
        {button(ui("common.action_everyone", { "action": label }), confirmEnd)}
      </View>
    </> : button(label, () => setConfirming(true))}
  </View>;
}
