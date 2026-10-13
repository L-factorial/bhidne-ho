import {AppText as Text} from './AppText';
import {Pressable, ScrollView, View} from 'react-native';
import {PlayerAvatar} from './PlayerAvatar';
import {fonts, useTheme} from '../theme';
import {ui} from '../i18n/copy';
export type ChatPerson={user_id:string;display_name:string;username?:string|null;avatar_url?:string|null};
export function OnlinePeopleStrip({people,onPress,onlineIds}: {people:ChatPerson[];onPress?:(player:ChatPerson)=>void;onlineIds?:string[]}) {
  const {colors}=useTheme();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="chat-people-strip" contentContainerStyle={{gap:16,paddingVertical:12,paddingHorizontal:2}}>
    {people.map(player=><Pressable key={player.user_id} accessibilityRole={onPress?'button':undefined} accessibilityLabel={player.display_name || player.username || ui('common.player')}
      disabled={!onPress} onPress={()=>onPress?.(player)} style={{width:76,alignItems:'center',gap:6,minHeight:88}}>
      <View style={{borderWidth:2,borderColor:colors.coin,borderRadius:32,padding:2}}><PlayerAvatar size={54} uri={player.avatar_url || undefined}/>
        {onlineIds?.includes(player.user_id)&&<View accessibilityLabel={ui('common.online')} style={{position:'absolute',right:0,bottom:0,width:13,height:13,borderRadius:7,backgroundColor:colors.success,borderWidth:2,borderColor:colors.surface}}/>}
      </View>
      <Text numberOfLines={1} style={{fontFamily:fonts.medium,fontSize:12,color:colors.text,textAlign:'center',width:'100%'}}>{player.display_name || player.username || ui('common.player')}</Text>
    </Pressable>)}
  </ScrollView>;
}
