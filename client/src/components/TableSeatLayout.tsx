import { useTheme } from '../theme';
import {AppText as Text} from './AppText';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { type ReactNode, useState } from 'react';
import { TableSurface } from './TableSurface';
import {View} from 'react-native';
import { seatedOrder, tableSeatGeometry } from '../multiplayer/tableSeats';

export function TableSeatLayout<T extends { id: string }>({ players, viewerId, compact = false, fill = false, renderSeat, children, testID, game = 'callbreak', capacity, geometry }: {
  geometry?: (count: number, width: number) => ReturnType<typeof tableSeatGeometry>;
  capacity?: number; game?: 'callbreak' | 'marriage'; players: T[]; viewerId: string; compact?: boolean; fill?: boolean; renderSeat: (player: T, index: number) => ReactNode;
  children: ReactNode | ((layout: ReturnType<typeof tableSeatGeometry>, ordered: T[]) => ReactNode); testID?: string;
}) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const [height, setHeight] = useState(360);
  const [width, setWidth] = useState(300);
  const ordered = seatedOrder(players, viewerId), layout = geometry ? geometry(capacity || ordered.length, width) : tableSeatGeometry(capacity || ordered.length, width, compact, fill ? height : capacity ? 400 : undefined);
  return <View testID={testID} onLayout={event => { setWidth(event.nativeEvent.layout.width); setHeight(event.nativeEvent.layout.height); }} style={{ width: '100%', maxWidth: 760, alignSelf: 'center', height: fill ? undefined : layout.height, flex: fill ? 1 : undefined, minHeight: fill ? 320 : undefined, maxHeight: undefined }}>
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 4, right: 4 }}><TableSurface game={game} /></View>
    {ordered.map((player, index) => {
      const point = layout.positions[index];
      return <View key={player.id} testID={`table-seat-${player.id}`} style={{ position: 'absolute', width: layout.seatWidth, height: layout.seatHeight,
        left: point.x - layout.seatWidth / 2, top: point.y - layout.seatHeight / 2 }}>{renderSeat(player, index)}</View>;
    })}
    {!!capacity && Array.from({ length: Math.max(0, capacity - ordered.length) }, (_, index) => {
      const point = layout.positions[index + ordered.length];
      return <View key={`empty-${index}`} accessibilityLabel={ui("rooms.empty_seat")} style={{ position: 'absolute', left: point.x - 24, top: point.y - 24, width: 48, alignItems: 'center', gap: 3 }}><View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: c.text, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.text, fontSize: 24 }}>+</Text></View><Text style={{ color: c.text, fontSize: 10 }}>{ui("flush.empty")}</Text></View>;
    })}
    {typeof children === 'function' ? children(layout, ordered) : <View style={{ position: 'absolute', top: capacity ? 0 : layout.center.y - 60, bottom: capacity ? 0 : undefined, justifyContent: capacity ? 'center' : undefined, left: capacity ? layout.seatWidth / 2 + 12 : 6, right: capacity ? layout.seatWidth / 2 + 12 : 6, alignItems: 'center' }}>{children}</View>}
  </View>;
}
