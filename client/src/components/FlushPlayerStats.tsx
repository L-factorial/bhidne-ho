import {View} from 'react-native';
import {AppText as Text} from './AppText';
import {useTheme} from '../theme';
import {ui} from '../i18n/copy';
export function FlushPlayerStats({net,bet,id,detailed=false}:{net:number;bet:number;id:string;detailed?:boolean}) {
 const {colors:c}=useTheme(); const size=12;
 return <View testID={`flush-stats-${id}`} style={{flexDirection:detailed?'column':'row',alignItems:detailed?'flex-start':'center',gap:3}}>
 <Text testID={`flush-session-net-${id}`} accessibilityLabel={`${ui('flush.session_net')}: ${net}`} style={{fontSize:size,color:net>0?c.gain:net<0?c.loss:c.textMuted}}>{detailed?`${ui('flush.session_gain')} : `:''}{net>0?'+':''}{net}</Text>
 {!detailed&&<Text style={{fontSize:size,color:c.textMuted}}>/</Text>}
 <Text testID={`flush-round-bet-${id}`} accessibilityLabel={`${ui('flush.round_contribution')}: ${bet}`} style={{fontSize:size,color:c.accent}}>{detailed?`${ui('flush.bet_in_game')} : `:''}{bet}</Text>
 </View>;
}
