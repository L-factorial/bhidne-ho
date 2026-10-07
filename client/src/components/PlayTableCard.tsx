import {Pressable,Text,View} from 'react-native';
import {gameLabel} from '../i18n/display';
import {ui} from '../i18n/copy';
import {fonts,useTheme} from '../theme';
import {playEntry,type PlayTable} from '../multiplayer/playFeed';
import type {TableEntry} from '../multiplayer/tableNavigation';

export function PlayTableCard({table,busy,enter,discard}:{table:PlayTable;busy:boolean;enter:(action:TableEntry)=>void;discard:()=>void}){
  const {colors:c}=useTheme(),action=playEntry(table);
  const label=action==='seat'||table.current_user?.is_seated?ui('rooms.join'):ui('rooms.watch');
  return <View testID={`play-table-${table.match_id}`} style={{padding:18,gap:10,borderRadius:20,borderWidth:1,borderColor:c.borderSubtle,backgroundColor:c.surface}}>
    <Text style={{color:c.accent,fontFamily:fonts.medium,fontSize:18}}>{gameLabel(table.game_type)}</Text>
    <Text style={{color:c.text,fontFamily:fonts.medium,fontSize:16}}>{table.room_name}</Text>
    <Text style={{color:c.text,fontFamily:fonts.body,fontSize:15}}>{table.name}</Text>
    <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
      <Text style={{flex:1,color:c.textMuted}}>{table.players}/{table.capacity} {ui('flush.seated')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} · ${table.name}`} disabled={busy} accessibilityState={{disabled:busy}}
        onPress={()=>enter(action)} style={{minHeight:44,minWidth:80,paddingHorizontal:18,borderRadius:12,backgroundColor:c.successSurface,alignItems:'center',justifyContent:'center',opacity:busy?0.5:1}}>
        <Text style={{color:c.success,fontFamily:fonts.medium}}>{label}</Text>
      </Pressable>
      {!!table.invitation_id&&<Pressable accessibilityRole="button" accessibilityLabel={`${ui('rooms.discard_invitation')} · ${table.name}`} disabled={busy} accessibilityState={{disabled:busy}}
        onPress={discard} style={{minHeight:44,paddingHorizontal:10,justifyContent:'center'}}><Text style={{color:c.textMuted,fontFamily:fonts.medium}}>{ui('rooms.discard_invitation')}</Text></Pressable>}
    </View>
  </View>;
}
