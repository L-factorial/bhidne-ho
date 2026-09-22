import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image, ScrollView, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export type ResultRow = { id: string; name: string; avatarUrl?: string; own?: boolean; winner?: boolean; values: { text: string; amount?: number }[] };
function ResultAvatar({ uri }: { uri?: string }) {
  const [failed, setFailed] = useState<string>();
  return <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#E5E5E5', borderWidth: 1, borderColor: '#A3A3A3', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {uri && failed !== uri ? <Image accessibilityLabel="Player photo" source={{ uri }} onError={() => setFailed(uri)} style={{ width: 32, height: 32, borderRadius: 16 }} />
      : <Ionicons accessibilityLabel="Anonymous player profile" name="person" size={24} color="#737373" />}
  </View>;
}

export function RoundResultsTable({ title = 'Round complete!', subtitle, columns, rows, testID = 'round-results-table' }: {
  title?: string; subtitle?: string; columns: string[]; rows: ResultRow[]; testID?: string;
}) {
  const { colors: c } = useTheme();
  const [width, setWidth] = useState(0);
  const cellWidth = columns.length > 3 ? 48 : 58;
  return <View testID={testID} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.tableTrim, borderRadius: 20, overflow: 'hidden' }}>
    <View style={{ backgroundColor: c.tableHeader, padding: 18, gap: 6, alignItems: 'center' }}>
      <Ionicons name="trophy-outline" size={28} color={c.cardInnerBorder} accessible={false} />
      <Text accessibilityRole="header" style={{ fontFamily: fonts.editorial, fontSize: 30, textAlign: 'center', color: c.onTableHeader }}>{title}</Text>
      {!!subtitle && <Text style={{ fontFamily: fonts.body, fontSize: 13, textAlign: 'center', color: c.onTableHeader }}>{subtitle}</Text>}
    </View>
    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ width: Math.max(width - 2, 132 + columns.length * cellWidth) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceRaised, paddingVertical: 12 }}>
          <Text style={{ flex: 1, minWidth: 132, paddingLeft: 12, color: c.textMuted, fontFamily: fonts.medium, fontSize: 12 }}>Player</Text>
          {columns.map(column => <Text key={column} style={{ width: cellWidth, textAlign: 'center', fontFamily: fonts.medium, fontSize: 11, color: c.textMuted }}>{column}</Text>)}
        </View>
        {rows.map(row => <View key={row.id} testID={`result-player-${row.id}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, borderTopWidth: 1, borderColor: c.borderSubtle, backgroundColor: row.own ? c.ownMessage : c.surface }}>
          <View style={{ flex: 1, minWidth: 132, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ResultAvatar uri={row.avatarUrl} />
            <View style={{ flex: 1, paddingVertical: 8 }}><Text numberOfLines={2} style={{ fontFamily: fonts.medium, color: c.text, fontSize: 12 }}>{row.name}{row.own ? ' · You' : ''}</Text>
              {row.winner && <Text style={{ fontFamily: fonts.body, color: c.success, fontSize: 10 }}>Winner</Text>}</View>
          </View>
          {row.values.map((value, index) => <Text key={index} style={{ width: cellWidth, paddingHorizontal: 2, textAlign: 'center', fontFamily: fonts.medium, fontSize: 13, fontVariant: ['tabular-nums'], color: value.amount === undefined || value.amount === 0 ? c.text : value.amount < 0 ? c.danger : c.success }}>{value.text}</Text>)}
        </View>)}
      </View>
    </ScrollView>
  </View>;
}
