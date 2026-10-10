import { KeyboardFocusBoundary } from './KeyboardFocusBoundary';
import {AppText as Text} from './AppText';
import { GameModal as Modal } from './GameModal';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {Platform, Pressable, useWindowDimensions, View} from 'react-native';
import { visualStates, radii, fonts, useTheme } from '../theme';
import { ui } from '../i18n/copy';

/** A compact menu anchored to its trigger, outside scroll/bubble clipping. */
export function ContextMenu({label, children}: {label:string; children:ReactNode | ((close:()=>void)=>ReactNode)}) {
  const {colors:c}=useTheme(), {width,height}=useWindowDimensions();
  const anchor=useRef<View>(null), menu=useRef<View>(null);
  const [menuHeight,setMenuHeight]=useState(160);
  const [position,setPosition]=useState<{x:number;y:number}|null>(null);
  const close=()=>setPosition(null);
  useEffect(()=>{
    if(!position||Platform.OS!=='web')return;
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopImmediatePropagation();close();}};
    globalThis.addEventListener('keyup',escape,true);
    return()=>globalThis.removeEventListener('keyup',escape,true);
  },[position]);
  return <>
    <Pressable ref={anchor} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{expanded:!!position}} hitSlop={8}
      onPress={()=>anchor.current?.measureInWindow((x,y,w,h)=>setPosition({x:x+w,y:y+h}))}
      style={{width:28,height:28,alignItems:'center',justifyContent:'center'}}>
      <Text style={{color:c.textMuted,fontSize:20,lineHeight:22}}>⋯</Text>
    </Pressable>
    <Modal transparent visible={!!position} animationType="none" onRequestClose={close} onShow={()=>{if(Platform.OS==='web')(menu.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>('[role="button"]')?.focus();}}>
      <KeyboardFocusBoundary enabled visible={!!position} label={label} onClose={close}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui('common.close')} onPress={close} style={{position:'absolute',top:0,bottom:0,left:0,right:0}} />
      <View ref={menu} accessibilityViewIsModal onLayout={event=>setMenuHeight(event.nativeEvent.layout.height)} style={{position:'absolute',left:Math.max(8,Math.min((position?.x??0)-220,width-228)),top:Math.max(8,Math.min(position?.y??0,height-menuHeight-8)),width:220,padding:8,gap:4,backgroundColor:c.surface,borderWidth:1,borderColor:c.border,borderRadius: radii.medium,boxShadow:`0px 8px 24px ${c.shadow}`}}>{typeof children==='function'?children(close):children}</View>
      </KeyboardFocusBoundary>
    </Modal>
  </>;
}
export function MenuAction({label,onPress,danger=false,disabled=false}: {label:string;onPress:()=>void;danger?:boolean;disabled?:boolean}) {
 const {colors:c}=useTheme();
 return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{minHeight:44,paddingHorizontal:10,justifyContent:'center',opacity:disabled ? visualStates.disabledOpacity : 1}}><Text style={{fontFamily:fonts.medium,fontSize:13,color:danger?c.danger:c.text}}>{label}</Text></Pressable>;
}
