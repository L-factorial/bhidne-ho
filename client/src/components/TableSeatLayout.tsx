import { type ReactNode, useState } from 'react';
import { TableSurface } from './TableSurface';
import { View } from 'react-native';
import { seatedOrder, tableSeatGeometry } from '../multiplayer/tableSeats';

export function TableSeatLayout<T extends { id: string }>({ players, viewerId, compact = false, fill = false, renderSeat, children, testID, game = 'callbreak' }: {
  game?: 'callbreak' | 'marriage'; players: T[]; viewerId: string; compact?: boolean; fill?: boolean; renderSeat: (player: T) => ReactNode;
  children: ReactNode | ((layout: ReturnType<typeof tableSeatGeometry>, ordered: T[]) => ReactNode); testID?: string;
}) {
  const [height, setHeight] = useState(360);
  const [width, setWidth] = useState(300);
  const ordered = seatedOrder(players, viewerId), layout = tableSeatGeometry(ordered.length, width, compact, fill ? height : undefined);
  return <View testID={testID} onLayout={event => { setWidth(event.nativeEvent.layout.width); setHeight(event.nativeEvent.layout.height); }} style={{ width: '100%', maxWidth: 760, alignSelf: 'center', height: fill ? undefined : layout.height, flex: fill ? 1 : undefined, minHeight: fill ? 360 : undefined, maxHeight: fill ? 560 : undefined }}>
    <View pointerEvents="none" style={{ position: 'absolute', top: 12, bottom: 12, left: 4, right: 4 }}><TableSurface game={game} /></View>
    {ordered.map((player, index) => {
      const point = layout.positions[index];
      return <View key={player.id} testID={`table-seat-${player.id}`} style={{ position: 'absolute', width: layout.seatWidth, height: layout.seatHeight,
        left: point.x - layout.seatWidth / 2, top: point.y - layout.seatHeight / 2 }}>{renderSeat(player)}</View>;
    })}
    {typeof children === 'function' ? children(layout, ordered) : <View style={{ position: 'absolute', top: layout.center.y - 60, left: 6, right: 6, alignItems: 'center' }}>{children}</View>}
  </View>;
}
