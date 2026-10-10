import {AppText as Text} from './AppText';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import {View} from 'react-native';
import { CardBack } from './CardBack';
import { fonts, useTheme } from '../theme';

export function HandTrayLabel({ count }: { count?: number }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1 }}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 30, height: 32, flexShrink: 0 }}>
      {[-12, 10].map((angle, i) => <View key={angle} style={{ position: 'absolute', left: i * 7, top: 2, width: 21, height: 28, borderRadius: 4, borderWidth: 1, borderColor: c.tableTrim, transform: [{ rotate: `${angle}deg` }] }}><CardBack /></View>)}
    </View>
    <Text style={{ flexShrink: 1, minWidth: 0, color: c.onTableHeader, fontFamily: fonts.medium, fontSize: 14 }}>{count === undefined ? ui("common.your_cards") : ui("common.your_cards_status", { "status": count })}</Text>
  </View>;
}
