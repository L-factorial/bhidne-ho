import {gameControlStyle as gameButtonStyle,gameControlText} from '../gameControls';
import {ActivityLine} from './ActivityLine';
import {AppText as Text} from './AppText';
import {ui} from '../i18n/copy.ts';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {CardBack} from './CardBack';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {MarriageHandCard} from './MarriageHandCard';
import {cardDropTarget, insertHandCardBefore, type CardBounds} from '../multiplayer/marriageHandOrder';
import {groupedCallBreakHand, reconcileCallBreakHand} from '../multiplayer/callbreakHandOrder';
import {callBreakCardArea, isCallBreakThrow} from '../multiplayer/callbreakCardArea';
import {Pressable, StyleSheet, Text as TabText, View, useWindowDimensions} from 'react-native';
import {visualStates, radii, fonts, useTheme, useThemedStyles, type ThemeColors} from '../theme';

const suits:Record<string,string>={S:'♠',C:'♣',H:'♥',D:'♦'};
export type HandView='fan'|'grid';
export function PlayerHand({hand,legalCards,canPlay,onPlay,view='fan',onViewChange,onRevealComplete,turnKey='',dealKey='',onDragChange,controls,sending=false}: {
  sending?:boolean; controls?:ReactNode; compactControls?:boolean; onDragChange?:(dragging:boolean)=>void;
  turnKey?:string; onRevealComplete?:(dealKey:string|null)=>void;
  view?:HandView;onViewChange?:(view:HandView)=>void;dealKey?:string;
  hand:string[];legalCards:string[];canPlay:boolean;onPlay:(card:string)=>void;
}) {
  useUiLanguage();
  const {colors}=useTheme(),styles=useThemedStyles(createStyles);
  const {height}=useWindowDimensions();
  const [width,setWidth]=useState(280);
  const [arrangement,setArrangement]=useState<'personal'|'auto'>('auto');
  const [manual,setManual]=useState<{dealKey:string;cards:string[]}>({dealKey,cards:[]});
  const [revealed,setRevealed]=useState<{dealKey:string;cards:string[]}>({dealKey,cards:[]});
  const [hiddenDeal,setHiddenDeal]=useState<string|null>(null);
  const [chosen,setChosen]=useState<{key:string;card:string}|null>(null);
  const stage=useRef<View>(null);
  const cardNodes=useRef(new Map<string,View>());
  const register=useCallback((id:string,node:View|null)=>{if(node)cardNodes.current.set(id,node);else cardNodes.current.delete(id);},[]);
  const isRevealed=(card:string)=>revealed.dealKey===dealKey&&revealed.cards.includes(card);
  const revealing=hand.some(card=>!isRevealed(card));
  const hidden=!revealing&&hiddenDeal===dealKey;
  const choiceKey=`${dealKey}:${turnKey}`;
  const grouped=groupedCallBreakHand(hand,['S','H','C','D']);
  const personal=reconcileCallBreakHand(hand,manual.dealKey===dealKey?manual.cards:[]);
  const cards=revealing?hand:arrangement==='personal'?personal:grouped;
  const selected=chosen?.key===choiceKey&&canPlay&&!hidden&&!revealing&&hand.includes(chosen.card)&&legalCards.includes(chosen.card)?chosen.card:null;
  const dragKey=`${choiceKey}:${hand.join(',')}:${view}:${revealing}:${hidden}:${cards.join(',')}`;
  const latest=useRef({dragKey,canPlay,legalCards,onPlay});latest.current={dragKey,canPlay,legalCards,onPlay};
  const dragStarted=useRef<string|null>(null);
  const submitted=useRef<string|null>(null);
  useEffect(()=>{submitted.current=null;setChosen(null);},[choiceKey,hand.join(',')]);
  useEffect(()=>{setChosen(null);},[canPlay,hidden,view,arrangement]);
  useEffect(()=>{onRevealComplete?.(hand.length>0&&!revealing?dealKey:null);},[revealing,dealKey,hand.length,onRevealComplete]);
  function revealNext(){setRevealed(current=>{const shown=current.dealKey===dealKey?current.cards:[];const next=hand.find(card=>!shown.includes(card));return {dealKey,cards:next?[...shown,next]:shown};});}
  function play(card:string){
    if(latest.current.dragKey!==dragKey||!latest.current.canPlay||!latest.current.legalCards.includes(card)||hidden||revealing||submitted.current===choiceKey)return;
    submitted.current=choiceKey;setChosen(null);latest.current.onPlay(card);
  }
  // A rejection unlocks the same turn; a successful action changes its snapshot.
  useEffect(()=>{if(!canPlay)submitted.current=null;},[canPlay]);
  async function drop(source:string,x:number,y:number,gesture?:{dx:number;dy:number;vy:number}){
    if(revealing||hidden||latest.current.dragKey!==dragKey||dragStarted.current!==dragKey)return;
    if(gesture&&isCallBreakThrow(gesture.dx,gesture.dy,gesture.vy)) {
      const node=stage.current;if(!node)return;
      const top=await new Promise<number>(resolve=>node.measureInWindow((_x,y)=>resolve(y)));
      if(latest.current.dragKey!==dragKey)return;
      if(y<top-20){play(source);return;}
    }
    const bounds=await Promise.all([...cardNodes.current].map(([id,node])=>new Promise<CardBounds>(resolve=>node.measureInWindow((x,y,width,height)=>resolve({id,x,y,width,height})))));
    if(latest.current.dragKey!==dragKey)return;
    const target=cardDropTarget(bounds,source,x,y);
    if(target){setChosen(null);setManual({dealKey,cards:insertHandCardBefore(cards,source,target)});setArrangement('personal');}
  }
  const layout=callBreakCardArea(width,height,hand.length);
  const displayGrid=view==='grid'&&!revealing;
  const button=(label:string,onPress:()=>void,disabled=false,primary=false,accessibilityLabel=label,loading=false)=><Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[styles.option,gameButtonStyle(colors,primary?'primary':'secondary',false,disabled),disabled&&{opacity:visualStates.disabledOpacity}]}><>{loading?<ActivityLine/>:<Text numberOfLines={1} adjustsFontSizeToFit style={[styles.label,{color:gameControlText(primary?'primary':'secondary',disabled)}]}>{label}</Text>}</></Pressable>;
  return <View testID="player-hand" onLayout={event=>setWidth(event.nativeEvent.layout.width)} style={{gap:6}}>
    <View accessibilityRole="tablist" testID="callbreak-arrangement-tabs" style={styles.row}>
      {(['personal','auto'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityLabel={ui(value==='personal'?'marriage.my_arrangement':'marriage.auto_arrangement')} accessibilityState={{selected:arrangement===value,disabled:revealing}} aria-selected={arrangement===value} disabled={revealing} onPress={()=>setArrangement(value)} style={[styles.arrangement,arrangement===value&&gameButtonStyle(colors,'selected'),revealing&&{opacity:visualStates.disabledOpacity}]}>
        <TabText numberOfLines={1} adjustsFontSizeToFit style={styles.label}>{ui(value==='personal'?'marriage.my_arrangement':'marriage.auto_arrangement')}</TabText>
      </Pressable>)}
      {!revealing&&<Pressable accessibilityRole="button" accessibilityLabel={ui(hidden?'common.show_cards':'common.hide_cards')} onPress={()=>setHiddenDeal(hidden?null:dealKey)} style={[styles.arrangement,{flex:0,flexBasis:56,flexShrink:0,width:56}]}><TabText numberOfLines={1} adjustsFontSizeToFit style={styles.label}>{ui(hidden?'callbreak.show_hand':'callbreak.hide_hand')}</TabText></Pressable>}
    </View>
    <View ref={stage} testID="callbreak-card-stage" style={{height:layout.stageHeight,alignItems:'center',justifyContent:'center',overflow:'visible'}}>
      {displayGrid?<View style={{width:layout.columns*(layout.gridWidth+5)-5,flexDirection:'row',flexWrap:'wrap',gap:5}}>
        {cards.map(card=>renderCard(card,true))}
      </View>:<View style={{width:'100%',height:layout.stageHeight}}>{cards.map(card=>renderCard(card,false))}</View>}
    </View>
    {controls}
    <View testID="callbreak-hand-footer" style={{gap:6}}>
      {revealing&&<View style={styles.row}>
        {button(ui('common.reveal_next'),revealNext,false,false,ui('common.reveal_next_card'))}
        {button(ui('common.flip_all'),()=>setRevealed({dealKey,cards:[...hand]}),false,false,ui('common.flip_all_cards'))}
      </View>}
      <View style={styles.row}>
        <View accessibilityRole="radiogroup" accessibilityLabel={ui('common.hand_view')} style={[styles.row,{flex:1}]}>
          {(['grid','fan'] as const).map(mode=><Pressable key={mode} accessibilityRole="radio" accessibilityLabel={ui(mode==='fan'?'common.arc':'common.card_grid')} accessibilityState={{checked:view===mode,disabled:revealing}} aria-checked={view===mode} disabled={revealing} onPress={()=>onViewChange?.(mode)} style={[styles.option,view===mode&&{...gameButtonStyle(colors,'selected')},revealing&&{opacity:visualStates.disabledOpacity}]}><Text style={styles.label}>{ui(mode==='fan'?'common.arc':'common.grid')}</Text></Pressable>)}
        </View>
        {!revealing&&button(hidden?ui('callbreak.show_hand'):ui('callbreak.play_selected_card'),()=>hidden?setHiddenDeal(null):selected&&play(selected),!hidden&&(!selected||sending),!hidden,ui(hidden?'common.show_cards':'callbreak.play_selected_card'),sending&&!hidden)}
      </View>
    </View>
  </View>;
  function renderCard(card:string,grid:boolean){
    const index=cards.indexOf(card),faceUp=!hidden&&isRevealed(card),enabled=!revealing&&faceUp&&canPlay&&legalCards.includes(card);
    const angle=cards.length>1?index/(cards.length-1)*layout.spread-layout.spread/2:0;
    const position=cards.length>1?index/(cards.length-1)*2-1:0;
    const cardWidth=grid?layout.gridWidth:layout.cardWidth,cardHeight=grid?layout.gridHeight:layout.cardHeight;
    return <MarriageHandCard key={card} id={card} testID={`callbreak-hand-card-${card}`} register={register} onDragChange={value=>{dragStarted.current=value?dragKey:null;onDragChange?.(value);}} onDrop={drop} arcAngle={grid?undefined:angle}
      allowDisabledDrag disabled={false} dragDisabled={revealing||hidden} pressDisabled={!revealing&&!enabled} selected={selected===card}
      label={hidden?ui('common.your_hand_is_face_down'):revealing?ui('common.reveal_next_card_from_position_position',{position:index+1}):ui('common.select_card',{card})} hint={ui(hidden?'common.show_cards':'callbreak.arrange_throw_hint')}
      onPress={()=>revealing?revealNext():enabled&&setChosen(current=>current?.card===card?null:{key:choiceKey,card})}
      wrapperStyle={{width:cardWidth,height:cardHeight,paddingTop:0,...(!grid?{position:'absolute',left:width/2-cardWidth/2+position*7,top:14+(selected===card?-8:0)}:{})}}
      style={[styles.card,{width:cardWidth,height:cardHeight,backgroundColor:faceUp?selected===card?colors.cardSelected:colors.cardFace:colors.cardBack,borderColor:selected===card?'#DC2626':enabled?colors.attention:colors.cardBorder,borderWidth:selected===card?4:2,overflow:selected===card?'visible':'hidden',opacity:faceUp&&canPlay&&!enabled ? .55 : 1}]}>
      {selected===card&&<TabText pointerEvents="none" accessible={false} testID="callbreak-selected-card-arrow" style={{position:'absolute',top:-14,left:'50%',marginLeft:-7,fontSize:14,lineHeight:14,fontWeight:'bold',color:'#DC2626'}}>▼</TabText>}
      {faceUp?<View style={{position:'absolute',top:3,left:4,alignItems:'center'}}><Text style={{fontFamily:fonts.medium,fontSize:grid?Math.min(18,cardWidth*.35):17,lineHeight:21,color:/[HD]$/.test(card)?colors.cardRed:card.endsWith('C')?colors.cardClub:colors.cardInk}}>{card.slice(0,-1)}{grid?suits[card.slice(-1)]:''}</Text>{!grid&&<Text style={{fontSize:21,lineHeight:24,color:/[HD]$/.test(card)?colors.cardRed:card.endsWith('C')?colors.cardClub:colors.cardInk}}>{suits[card.slice(-1)]}</Text>}</View>:<CardBack/>}
    </MarriageHandCard>;
  }
}
const createStyles=(colors:ThemeColors)=>StyleSheet.create({
  row:{flexDirection:'row',gap:4,alignItems:'center'},
  arrangement:{...gameButtonStyle(colors),flex:1,minWidth:0,height:44,minHeight:44,paddingHorizontal:4,paddingVertical:4,alignItems:'center',justifyContent:'center'},
  option:{...gameButtonStyle(colors),flex:1,minWidth:0,minHeight:44,paddingHorizontal:6,paddingVertical:6,alignItems:'center',justifyContent:'center'},
  label:{fontFamily:fonts.medium,color:gameControlText(),fontSize:12,lineHeight:16,textAlign:'center'},
  card:{borderRadius:radii.medium,overflow:'hidden',boxShadow:`0px 3px 6px ${colors.shadow}`},
});
