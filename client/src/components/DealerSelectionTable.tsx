import { MobileGameHand } from './MobileGameHand';
import { useEffect, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from './AppText';
import { CardBack } from './CardBack';
import { CompactCardFace } from './CompactCardFace';
import { PlayerSeat } from './PlayerSeat';
import { TableSeatLayout } from './TableSeatLayout';
import { useTheme, fonts, gameButtonStyle } from '../theme';
import { ui } from '../i18n/copy';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function DealerSelectionTable({ snapshot, busy, onPick }: {
  snapshot: RoomSnapshot; busy: boolean; onPick: (position: number) => void;
}) {
  const { colors: c } = useTheme();
  const mobile=useWindowDimensions().width<900;
  const [open,setOpen]=useState(true),[collapsedHeight,setCollapsedHeight]=useState(93);
  const selection = snapshot.game!.dealer_selection!;
  const players = (snapshot.players || []).map(p => ({ ...p, id: String(p.player_id) }));
  const mine = snapshot.your_player_id === selection.current_player;
  const ownPick=selection.picks.find(p=>p.player_id===snapshot.your_player_id);
  useEffect(()=>{if(mine)setOpen(true);},[mine,selection.picks.length]);
  const canFlip = mine && !busy && selection.available_positions.length > 0;
  const flipCard = () => {
    if (!canFlip) return;
    const positions = selection.available_positions;
    onPick(positions[Math.floor(Math.random() * positions.length)]);
  };
  const actor = players.find(p => p.player_id === selection.current_player);
  return <View testID="callbreak-dealer-selection" style={{ flex:1, minHeight:0 }}>
    <View style={{flex:1,minHeight:0,paddingBottom:snapshot.your_player_id?collapsedHeight+12:0}}><TableSeatLayout fill players={players} viewerId={String(snapshot.your_player_id)} renderSeat={player => {
      return <View style={{ alignItems: 'center', gap: 4 }}>
        <PlayerSeat playerId={player.player_id} name={player.display_name || ui('common.player_number', { number: player.player_id })}
          mine={player.player_id === snapshot.your_player_id} active={player.player_id === selection.current_player}
          avatarUrl={player.avatar_url} connected={player.connected} compact />

      </View>;
    }}>
      <View style={{alignItems:'center',gap:8}}><Text accessibilityLiveRegion="polite" style={{ textAlign: 'center', color: c.text, fontFamily: fonts.medium }}>
        {mine ? ui('callbreak.your_dealer_pick') : ui('callbreak.waiting_dealer_pick', { player: actor?.display_name || ui('common.player_number', { number: selection.current_player }) })}
      </Text>
      <Pressable testID="dealer-center-deck" accessibilityRole="button" accessibilityLabel={ui('common.flip_card')}
        disabled={!canFlip} accessibilityState={{disabled:!canFlip}} onPress={flipCard}
        style={({pressed})=>({width:58,height:84,borderRadius:6,overflow:'hidden',opacity:pressed?0.7:1,
          borderWidth:1,borderColor:canFlip?c.attention:c.cardBorder})}>
        <CardBack />
      </Pressable>
      <View style={{flexDirection:'row',gap:6,justifyContent:'center'}}>
        {selection.picks.map(pick=><View key={pick.player_id} style={{width:40,alignItems:'center',gap:2}}>
          <View testID={`dealer-pick-${pick.player_id}`} accessibilityLabel={pick.card} style={{width:36,height:50,borderRadius:5,overflow:'hidden',backgroundColor:c.cardFace,borderWidth:1,borderColor:c.cardBorder,justifyContent:'center'}}>
            <CompactCardFace compact rank={pick.card.slice(0,-1)} suit={pick.card.slice(-1)}/>
          </View>
          <Text numberOfLines={1} style={{maxWidth:40,color:c.textMuted,fontSize:10}}>{players.find(p=>p.player_id===pick.player_id)?.display_name}</Text>
        </View>)}
      </View></View>
    </TableSeatLayout></View>
    {!!snapshot.your_player_id && <MobileGameHand mobile={mobile} desktopDrawer docked overlay game="callbreak" cardCount={1} open={open} onToggle={()=>setOpen(v=>!v)} onCollapsedHeight={setCollapsedHeight} myTurn={mine}
      cue={mine?{key:`dealer:${selection.picks.length}`,title:'common.attention_turn',detail:'common.flip_card',required:true,opportunities:[]}:null}>
      <View testID="dealer-selection-deck" style={{padding:12,gap:10,alignItems:'center'}}>
        <Text style={{color:c.textMuted,textAlign:'center'}}>{ui('callbreak.dealer_draw_rules')}</Text>
        <View style={{width:58,height:84,borderRadius:6,overflow:'hidden',backgroundColor:c.cardFace,justifyContent:'center'}}>
          {ownPick?<CompactCardFace rank={ownPick.card.slice(0,-1)} suit={ownPick.card.slice(-1)}/>:<CardBack />}
        </View>
        <Pressable testID="dealer-flip-card" accessibilityRole="button" accessibilityLabel={ui('common.flip_card')}
          disabled={!canFlip} accessibilityState={{disabled:!canFlip}}
          onPress={flipCard}
          style={({pressed})=>({...gameButtonStyle(c,'secondary',pressed),minHeight:44,paddingHorizontal:24,justifyContent:'center',opacity:mine&&!busy?1:0.5})}>
          <Text style={{color:c.text,fontFamily:fonts.medium}}>{ui('common.flip_card')}</Text>
        </Pressable>
      </View>
    </MobileGameHand>}
  </View>;
}
