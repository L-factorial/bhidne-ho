import {ui} from '../i18n/copy';
import {View} from 'react-native';
import {AppText as Text} from './AppText';
import {fonts,useTheme} from '../theme';
const suits:Record<string,string>={S:'♠',H:'♥',D:'♦',C:'♣'};
/** Separate rank and suit rows keep double-digit ranks centered in small cards. */
export function CompactCardFace({rank,suit,joker=false,compact=false}:{rank:string|number|null;suit:string|null;joker?:boolean;compact?:boolean}){
 const {colors:c}=useTheme();const color=['H','D','♥','♦'].includes(suit||'')?c.cardRed:c.cardInk;
 const face=typeof rank==='number'?({11:'J',12:'Q',13:'K',14:'A'} as Record<number,string>)[rank]||String(rank):rank;
 return <View pointerEvents="none" style={{alignItems:'center',justifyContent:'center'}}>
  <Text style={{fontFamily:fonts.medium,fontSize:joker?15:compact?17:21,color,textAlign:'center'}}>{joker?ui('common.joker'):face}</Text>
  {!joker&&<Text style={{fontSize:compact?16:20,color,textAlign:'center'}}>{suits[suit||'']||suit}</Text>}
 </View>;
}
