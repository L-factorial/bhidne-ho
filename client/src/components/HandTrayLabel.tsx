import { Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function HandTrayLabel({ count }: { count?: number }) {
  const { colors: c } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 }}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 30, height: 32 }}>
      {[-12, 10].map((angle, i) => <View key={angle} style={{ position: 'absolute', left: i * 7, top: 2, width: 21, height: 28, borderRadius: 4, borderWidth: 1, borderColor: c.tableTrim, backgroundColor: c.cardBack, transform: [{ rotate: `${angle}deg` }] }} />)}
    </View>
    <Text numberOfLines={1} style={{ color: c.onTableHeader, fontFamily: fonts.medium, fontSize: 14 }}>{count === undefined ? 'Your cards' : `Your cards · ${count}`}</Text>
  </View>;
}
