import {Pressable,View,type StyleProp,type ViewStyle} from 'react-native';
import {AppText as Text} from './AppText';
import {CompactCardFace} from './CompactCardFace';
import {MarriageCardBack} from './MarriageCardBack';
import {physicalLabel,type MarriageCard,type MarriageMeld} from '../multiplayer/marriage';
import {ui} from '../i18n/copy';
import {fonts,useTheme} from '../theme';

/** Publicly declared cards stay in the hand, outside selection and drag targets. */
export function MarriageDeclaredTunnelas({groups,hand,cardWidth,cardHeight=76,faceScale=1,hidden,cardStyle,backStyle}:{
  groups:MarriageMeld[];hand:MarriageCard[];cardWidth:number;cardHeight?:number;faceScale?:number;hidden:boolean;
  cardStyle:StyleProp<ViewStyle>;backStyle:StyleProp<ViewStyle>;
}){
  const {colors}=useTheme();
  const content=groups.map((group,index)=>{
    const cards=group.card_ids.map(id=>hand.find(card=>card.card_id===id)).filter((card):card is MarriageCard=>!!card);
    if(!cards.length)return null;
    return <View key={group.card_ids.join(',')} testID={`marriage-declared-tunnela-${index}`} style={{width:cards.length*cardWidth+(cards.length-1)*5,height:cardHeight+14,paddingTop:14,flexDirection:'row',gap:5}}>
      {cards.map(card=><Pressable key={card.card_id} testID={`marriage-hand-card-${card.card_id}`} accessibilityRole="button" disabled accessibilityState={{disabled:true}}
        accessibilityLabel={hidden?ui('common.hidden_card'):`${physicalLabel(card.card_id)} · ${ui('marriage.declared_tunnela')}`}
        style={[cardStyle,{width:cardWidth,height:cardHeight,opacity:0.35},hidden&&backStyle]}>
        {hidden?<MarriageCardBack/>:<CompactCardFace rank={card.rank} suit={card.suit} joker={card.card_type==='man'} scale={faceScale}/>}
      </Pressable>)}
      <View pointerEvents="none" style={{position:'absolute',top:14,bottom:0,left:0,right:0,alignItems:'center',justifyContent:'center'}}>
        <Text style={{color:colors.textMuted,opacity:0.75,fontFamily:fonts.medium,fontSize:12,textAlign:'center'}}>{ui('marriage.declared_tunnela')}</Text>
      </View>
    </View>;
  });
  return groups.length>2 ? <View testID="marriage-declared-tunnela-rows" style={{width:'100%'}}>
    <View style={{width:cardWidth*6+25,maxWidth:'100%',flexDirection:'row',flexWrap:'wrap',gap:5}}>{content}</View>
  </View> : <>{content}</>;
}
