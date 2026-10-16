import {ArrangementSeat,ArrangementHint,useSeatArrangement} from './SeatArrangement';
import { useTheme } from '../theme';
import {AppText as Text} from './AppText';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { type ReactNode, useState } from 'react';
import { TableSurface } from './TableSurface';
import {View} from 'react-native';
import { seatedOrder, tableSeatGeometry } from '../multiplayer/tableSeats';

export function TableSeatLayout<T extends { id: string }>({ players, viewerId, compact = false, fill = false, renderSeat, children, testID, game = 'callbreak', capacity, geometry, hideHint = false }: {
  hideHint?:boolean; geometry?: (count: number, width: number) => ReturnType<typeof tableSeatGeometry>;
  capacity?: number; game?: 'callbreak' | 'marriage'; players: T[]; viewerId: string; compact?: boolean; fill?: boolean; renderSeat: (player: T, index: number) => ReactNode;
  children: ReactNode | ((layout: ReturnType<typeof tableSeatGeometry>, ordered: T[]) => ReactNode); testID?: string;
}) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const [rowHeight,setRowHeight]=useState(88);
  const [centerHeight,setCenterHeight]=useState(260);
  const [height, setHeight] = useState(360);
  const [width, setWidth] = useState(300);
  const arrangement = useSeatArrangement();
  const positions = arrangement?.snapshot.table?.seated_players;
  const positionFor = (id: string) => { const player = arrangement?.snapshot.table?.phase === 'COMPLETED' ? positions?.find(p=>String(p.seat_id)===id) : arrangement?.snapshot.players?.find(p=>String(p.player_id)===id); return capacity ? positions?.find(p=>p.user_id===player?.user_id)?.position_id : undefined; };
  const ownPosition = positionFor(viewerId) ?? 1;
  const slotCount = capacity || players.length;
  const visualIndex = (position:number) => (position - ownPosition + slotCount) % slotCount;
  const ordered = seatedOrder(players, viewerId);
  const minimumHeight = Math.max(fill ? 320 : 0, rowHeight * 2 + 44 + (capacity ? centerHeight : 0));
  const base = geometry ? geometry(capacity || ordered.length, width) : tableSeatGeometry(capacity || ordered.length, width, compact, Math.max(fill ? height : capacity ? 400 : 360, minimumHeight));
  const seatHeight = geometry ? base.seatHeight : Math.max(base.seatHeight, rowHeight);
  const layout = {...base,seatHeight,positions:base.positions.map(point=>({...point,y:Math.max(seatHeight/2+14,Math.min(base.height-seatHeight/2-14,point.y))}))};
  const measureRow = (height:number) => {if(!geometry)setRowHeight(current=>Math.max(current,Math.ceil(height)+8));};
  return <View testID={testID} onLayout={event => { setWidth(event.nativeEvent.layout.width); setHeight(event.nativeEvent.layout.height); }} style={{ width: '100%', maxWidth: 760, alignSelf: 'center', height: fill ? undefined : layout.height, flex: fill ? 1 : undefined, minHeight: fill ? minimumHeight : undefined, maxHeight: undefined }}>
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 4, right: 4 }}><TableSurface game={game} /></View>
    {ordered.map((player, index) => {
      const position = positionFor(player.id);
      const point = layout.positions[position ? visualIndex(position) : index];
      const user = arrangement?.snapshot.table?.phase === 'COMPLETED' ? positions?.find(p=>String(p.seat_id)===player.id)?.user_id : arrangement?.snapshot.players?.find(p=>String(p.player_id)===player.id)?.user_id;
      return <View key={player.id} testID={`table-seat-${player.id}`} style={{ position: 'absolute', width: layout.seatWidth, height: layout.seatHeight,
        left: point.x - layout.seatWidth / 2, top: point.y - layout.seatHeight / 2 }}><ArrangementSeat onHeight={measureRow} interactive={!!capacity} position={position ?? index+1} userId={user}>{renderSeat(player, index)}</ArrangementSeat></View>;
    })}
    {!!capacity && Array.from({length:capacity}, (_,index)=>index+1).filter(position => !ordered.some((p,i)=>(positionFor(p.id)??i+1)===position)).map((position,index) => {
      const point = layout.positions[visualIndex(position)];
      return <View key={`empty-${index}`} accessibilityLabel={ui("rooms.empty_seat")} style={{ position: 'absolute', left: point.x - 24, top: point.y - 24, width: 48, alignItems: 'center', gap: 3 }}><ArrangementSeat position={position}><View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: c.text, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.text, fontSize: 24 }}>+</Text></View><Text style={{ color: c.text, fontSize: 10 }}>{ui("flush.empty")}</Text></ArrangementSeat></View>;
    })}
    {typeof children === 'function' ? children(layout, ordered) : <View pointerEvents="box-none" style={{ position: 'absolute', top: capacity ? 0 : layout.center.y - 60, bottom: capacity ? 0 : undefined, justifyContent: capacity ? 'center' : undefined, left: capacity ? layout.seatWidth / 2 + 12 : 6, right: capacity ? layout.seatWidth / 2 + 12 : 6, alignItems: 'center' }}><View pointerEvents="box-none" onLayout={event=>{if(capacity){const height=event.nativeEvent.layout.height;setCenterHeight(current=>Math.max(current,Math.ceil(height)+8));}}} style={{alignItems:"center",width:"100%"}}>{children}{!hideHint && <ArrangementHint />}</View></View>}
  </View>;
}
