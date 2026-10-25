import {useId,useState} from 'react';
import {Image,View} from 'react-native';
import {cardPreviewImages} from '../cardPreviewImages';
import {cardThemeCatalog,type CardThemeId} from '../cardThemeCatalog';
import Svg, {Circle, Defs, G, LinearGradient, Path, Rect, Stop} from 'react-native-svg';

export type GameArtworkKind = 'flush' | 'marriage' | 'callbreak';

const spade = 'M50 20C43 31 24 41 24 56C24 71 41 76 47 64C47 73 43 79 38 83H62C57 79 53 73 53 64C59 76 76 71 76 56C76 41 57 31 50 20Z';
const heart = 'M0 7C-14-6-19-14-12-20C-7-25-1-21 0-17C1-21 7-25 12-20C19-14 14-6 0 7Z';

function ArtworkColors({id}: {id:string}) {
  return <Defs>
    <LinearGradient id={`${id}-red`} x1="0%" y1="0%" x2="100%" y2="100%">
      <Stop offset="0" stopColor="#B40932"/><Stop offset="1" stopColor="#570B20"/>
    </LinearGradient>
    <LinearGradient id={`${id}-gold`} x1="0%" y1="0%" x2="100%" y2="100%">
      <Stop offset="0" stopColor="#FFF0A5"/><Stop offset="0.5" stopColor="#E9BC46"/><Stop offset="1" stopColor="#B97B22"/>
    </LinearGradient>
  </Defs>;
}

/** Shared, text-free game marks; the surrounding control supplies its label. */
export function GameArtwork({game,size}: {game:GameArtworkKind;size:number}) {
  const id=`game-${useId().replace(/:/g,'')}`;
  const gold=`url(#${id}-gold)`;
  return <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
    <ArtworkColors id={id}/>
    <Rect x={1.5} y={1.5} width={97} height={97} rx={18} fill={`url(#${id}-red)`} stroke={gold} strokeWidth={2}/>
    <Rect x={7} y={7} width={86} height={86} rx={12} fill="none" stroke={gold} strokeWidth={0.7} opacity={0.55}/>
    <Path d="M15 25V15H25M75 15H85V25M85 75V85H75M25 85H15V75" fill="none" stroke={gold} strokeWidth={1}/>
    {game==='flush'?<>
      <G rotation={-22} origin="39,55"><Rect x={22} y={27} width={33} height={49} rx={4} fill={gold} stroke="#FFF0A5"/><Path d={heart} transform="translate(38 54) scale(.55)" fill="#9A1230"/></G>
      <G rotation={20} origin="63,55"><Rect x={46} y={27} width={33} height={49} rx={4} fill={gold} stroke="#FFF0A5"/><Path d={spade} transform="translate(49 36) scale(.27)" fill="#9A1230"/></G>
      <Rect x={35} y={33} width={33} height={49} rx={4} fill={gold} stroke="#FFF0A5"/>
      <Path d={heart} transform="translate(51.5 63) scale(.58)" fill="#9A1230"/>
      <Circle cx={41} cy={40} r={1.6} fill="#9A1230"/><Circle cx={62} cy={75} r={1.6} fill="#9A1230"/>
    </>:game==='marriage'?<>
      <Circle cx={39} cy={60} r={17} fill="none" stroke={gold} strokeWidth={5}/>
      <Circle cx={62} cy={60} r={17} fill="none" stroke={gold} strokeWidth={5}/>
      <Path d="M39 32L35 21L44 26L50 16L56 26L65 21L61 32ZM40 37H60" fill="none" stroke={gold} strokeWidth={2.5} strokeLinejoin="round"/>
      <Circle cx={50} cy={13} r={2} fill={gold}/>
    </>:<Path d={spade} fill={gold} stroke="#FFE79B" strokeWidth={0.6}/>}
  </Svg>;
}

/** Pick once per empty-state mount; polling must not shuffle the artwork. */
export function EmptyTablesArtwork({theme:providedTheme}:{theme?:CardThemeId}={}) {
  const [fallbackTheme] = useState(() => {
    const themes=Object.keys(cardThemeCatalog) as CardThemeId[];
    return themes[Math.floor(Math.random()*themes.length)];
  });
  const theme=providedTheme??fallbackTheme;
  return <View testID={`empty-tables-artwork-${theme}`} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{width:196,height:140}}>
    {([{left:20,top:27,angle:'-18deg'},{left:108,top:27,angle:'18deg'},{left:64,top:8,angle:'0deg'}] as const).map((card,index)=><Image key={index} source={cardPreviewImages[theme]} accessible={false} resizeMode="cover"
      style={{position:'absolute',left:card.left,top:card.top,width:68,height:101,borderRadius:6,transform:[{rotate:card.angle}]}}/>)}
  </View>;
}

export function NoMatchingTablesArtwork({color}: {color:string}) {
  return <Svg width={64} height={64} viewBox="0 0 96 96" accessible={false}>
    <G fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={16} y={20} width={39} height={57} rx={5} rotation={-13} origin="35.5,48.5"/>
      <Path d="M40 65V18Q40 13 45 13H72Q77 13 77 18V46"/>
      <Circle cx={65} cy={62} r={15}/><Path d="M76 73L88 85"/>
    </G>
  </Svg>;
}
