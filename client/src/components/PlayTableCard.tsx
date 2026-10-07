import {AppText as Text} from './AppText';
import {Pressable, View} from 'react-native';
import {gameLabel} from '../i18n/display';
import {ui} from '../i18n/copy';
import {fonts,useTheme} from '../theme';
import {playEntry,type PlayTable} from '../multiplayer/playFeed';
import type {TableEntry} from '../multiplayer/tableNavigation';
import {GameIcon} from './BrandArt';

export function PlayTableCard({table,busy,enter,discard}:{table:PlayTable;busy:boolean;enter:(action:TableEntry)=>void;discard:()=>void}){
  const {colors:c}=useTheme(),action=playEntry(table);
  const players=table.seated_players?.length?table.seated_players:Array.from({length:Math.min(table.players,table.capacity)},(_,seat_id)=>({seat_id,display_name:''}));
  const label=action==='seat'||table.current_user?.is_seated?ui('rooms.join'):ui('rooms.watch');
  const button={minHeight:44,minWidth:80,paddingHorizontal:10,borderRadius:12,borderWidth:1,borderColor:c.coin,alignItems:'center' as const,justifyContent:'center' as const,opacity:busy?0.5:1};
  return <View testID={`play-table-${table.match_id}`} style={{padding:14,gap:12,borderRadius:20,borderWidth:1,borderColor:c.borderSubtle,backgroundColor:c.surface,flexDirection:'row',alignItems:'center'}}>
    <View style={{flex:1,minWidth:0,gap:10}}>
      <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
        <GameIcon game={table.game_type} size={48}/>
        <View style={{flex:1,minWidth:0,gap:4}}>
          <Text accessibilityRole="header" style={{color:c.accent,fontFamily:fonts.editorial,fontSize:26,lineHeight:32}}>{gameLabel(table.game_type)}</Text>
          <Text style={{color:c.textMuted,fontFamily:fonts.body,fontSize:15,lineHeight:22}}>{ui('common.room')} : {table.room_name}</Text>
          <Text style={{color:c.text,fontFamily:fonts.body,fontSize:15,lineHeight:22}}>{ui('common.table')} : {table.name}</Text>
        </View>
      </View>
      {!!players.length&&<View testID={`play-players-${table.match_id}`} style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>
        {players.map(player=><View key={player.seat_id} accessibilityLabel={player.display_name} style={{width:30,height:30,borderRadius:15,borderWidth:2,borderColor:c.tableTrim,backgroundColor:c.surfaceRaised,alignItems:'center',justifyContent:'center'}}><Text style={{color:c.text,fontFamily:fonts.medium}}>{player.display_name.trim().slice(0,1).toUpperCase()||'•'}</Text></View>)}
      </View>}
      <Text style={{color:c.textMuted}}>{table.players}/{table.capacity} {ui('flush.seated')}</Text>
    </View>
    <View style={{gap:8}}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} · ${table.name}`} disabled={busy} accessibilityState={{disabled:busy}} onPress={()=>enter(action)} style={{...button,backgroundColor:c.successSurface}}>
        <Text style={{color:c.success,fontFamily:fonts.medium}}>{label}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${ui('rooms.discard_invitation')} · ${table.name}`} disabled={busy} accessibilityState={{disabled:busy}} onPress={discard} style={{...button,backgroundColor:c.surfaceRaised}}>
        <Text style={{color:c.textMuted,fontFamily:fonts.medium}}>{ui('rooms.discard_invitation')}</Text>
      </Pressable>
    </View>
  </View>;
}
