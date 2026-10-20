import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { AppText as Text } from './AppText';
import { CompactCardFace } from './CompactCardFace';
import { PlayerAvatar } from './PlayerAvatar';
import { MarriageMeldCards } from './MarriageMeldCards';
import { MarriagePoints } from './MarriageScoring';
import { ui } from '../i18n/copy';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { fonts, useTheme } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function MarriageResults({snapshot}: {snapshot:RoomSnapshot}) {
  useUiLanguage();
  const {colors:c}=useTheme();
  const [tab,setTab]=useState('results');
  useEffect(()=>setTab('results'),[snapshot.match_id]);
  const pub=snapshot.marriage?.public;
  const name=(id:string)=>snapshot.players?.find(p=>String(p.player_id)===id)?.display_name||ui('common.player_number',{number:id});
  const text={color:c.text,fontFamily:fonts.body,fontSize:14};
  const heading={color:c.accent,fontFamily:fonts.medium,fontSize:16};
  if(!pub)return <MarriagePoints snapshot={snapshot}/>;
  const winner=pub.players.find(p=>p.player_id===pub.winner);
  const winnerProfile=snapshot.players?.find(p=>String(p.player_id)===pub.winner);
  const maal=pub.result_maal;
  const player=pub.players.find(p=>'player:'+p.player_id===tab);
  // Use only the explicit post-game projection. Never reconstruct other hands.
  const cards=player && (pub.final_hands?.find(p=>p.player_id===player.player_id)?.cards ||
    (snapshot.marriage?.private?.player_id===player.player_id?snapshot.marriage.private.hand:undefined));
  const tabs=[{id:'results',label:ui('marriage.results_tab')},{id:'points',label:ui('marriage.computation_tab')},...pub.players.map(p=>({id:'player:'+p.player_id,label:p.player_id===String(snapshot.your_player_id)?`${name(p.player_id)} (${ui("common.you")})`:name(p.player_id)}))];
  return <View testID="marriage-results" style={{flex:1,minHeight:0}}>
    <View style={{borderBottomWidth:1,borderColor:c.border,padding:8,flexShrink:0}}>
      <View accessibilityRole="tablist" style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{tabs.map(item=><Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{selected:tab===item.id}} aria-selected={tab===item.id} onPress={()=>setTab(item.id)} style={{maxWidth:'100%',minWidth:0,minHeight:44,paddingHorizontal:12,paddingVertical:8,borderRadius:10,borderWidth:1,borderColor:tab===item.id?c.accent:c.border,backgroundColor:tab===item.id?c.surfaceSelected:c.surface,justifyContent:'center'}}><Text style={{...text,color:tab===item.id?c.accent:c.text}}>{item.label}</Text></Pressable>)}</View>
    </View>
    <ScrollView key={tab} testID="marriage-result-content" style={{flex:1,minHeight:0}} contentContainerStyle={{padding:16,gap:16}}>
      {tab==='points'?<MarriagePoints snapshot={snapshot} computationOnly/>:player?<>
        <Text accessibilityRole="header" style={heading}>{name(player.player_id)} · {ui('marriage.final_cards')}</Text>
        <Text style={text}>{player.has_seen_maal?ui('marriage.maal_seen'):ui('marriage.maal_not_seen')}{player.folded?` · ${ui('marriage.folded')}`:''}</Text>
        {cards?<MarriageMeldCards groups={[{meld_type:'set',card_ids:cards.map(card=>card.card_id)}]} hideLabels/>:<Text style={text}>{ui('marriage.cards_unavailable')}</Text>}
        {!!player.shown_melds.length&&<><Text accessibilityRole="header" style={heading}>{ui('marriage.previously_shown')}</Text><MarriageMeldCards groups={player.shown_melds} hideLabels/></>}
      </>:<>
        <View testID="marriage-result-overview" style={{flexDirection:'row',alignItems:'center',gap:16}}>
          <View style={{flex:1,minWidth:0,gap:6,alignSelf:'stretch',alignItems:'center',justifyContent:'center'}}>
            <Text accessibilityRole="header" style={[heading,{textAlign:'center'}]}>{ui('marriage.winner')}</Text>
            {!!pub.winner && <PlayerAvatar uri={winnerProfile?.avatar_url} size={54}/>}
            <Text style={[heading,{textAlign:'center'}]}>{pub.winner?name(pub.winner):'—'}</Text>
          </View>
        {maal?<View testID="marriage-result-maal" style={{flex:1,minWidth:0,gap:8,alignSelf:'stretch',alignItems:'center',justifyContent:'center'}}>
          <Text style={heading}>{ui('marriage.maal')}</Text>
          <View accessibilityLabel={`tiplu: ${maal.tiplu.rank} ${maal.tiplu.suit}`} style={{width:54,height:78,borderRadius:7,borderWidth:1,borderColor:c.cardBorder,backgroundColor:c.cardFace,alignItems:'center',justifyContent:'center'}}>
            <CompactCardFace rank={maal.tiplu.rank} suit={maal.tiplu.suit}/>
          </View>
        </View>:<Text style={text}>{ui('marriage.maal_unavailable')}</Text>}
        </View>
        {!!winner?.shown_melds.length&&<><Text accessibilityRole="header" style={heading}>{ui('marriage.previously_shown')}</Text><MarriageMeldCards groups={winner.shown_melds} hideLabels/></>}
        {pub.won_by_fold?<Text style={text}>{ui('marriage.fold_win_help')}</Text>:<>
          <Text accessibilityRole="header" style={heading}>{ui('marriage.final_combo')}</Text>
          <MarriageMeldCards groups={pub.normal_finish?.melds||[...(winner?.shown_melds||[]),...(pub.winning_pair?.length?[{meld_type:'dublee' as const,card_ids:pub.winning_pair}]:[])]} hideLabels/>
          {!!pub.normal_finish&&<><Text style={text}>{ui('marriage.final_discard_excluded_from_scoring')}</Text><MarriageMeldCards groups={[{meld_type:'set',card_ids:[pub.normal_finish.discard_card_id]}]} hideLabels/></>}
        </>}
      </>}
    </ScrollView>
  </View>;
}
