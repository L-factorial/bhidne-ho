import { cardDragAngle } from '../multiplayer/cardDragAngle';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Animated, PanResponder, Pressable, type StyleProp, type View, type ViewStyle} from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A drag takes over only after movement, leaving ordinary card taps intact. */
export function MarriageHandCard({id, disabled, dragDisabled, selected, label, hint, style, children, register, onPress, onDragChange, onDrop, wrapperStyle, testID, pressDisabled = disabled, allowDisabledDrag = false, onHoverIn, onHoverOut, arcAngle}: {
  arcAngle?:number;
  // Keep the gesture surface interactive while independently guarding card taps.
  allowDisabledDrag?:boolean;
  onHoverIn?:()=>void; onHoverOut?:()=>void;
  wrapperStyle?:StyleProp<ViewStyle>; testID?:string; pressDisabled?:boolean;
  id:string; disabled:boolean; dragDisabled:boolean; selected:boolean; label:string; hint?:string;
  style:StyleProp<ViewStyle>; children:ReactNode;
  register:(id:string, node:View|null)=>void;
  onPress:()=>void; onDragChange:(dragging:boolean)=>void;
  onDrop:(id:string, x:number, y:number)=>void;
}) {
  const position = useRef(new Animated.ValueXY()).current;
  const rotation = useRef(new Animated.Value(arcAngle ?? 0)).current;
  useEffect(()=>{rotation.setValue(arcAngle ?? 0);},[arcAngle,rotation]);
  const [dragging,setDragging] = useState(false);
  const suppressedUntil = useRef(0);
  const latest = useRef({disabled,dragDisabled,onPress,onDragChange,onDrop,id,arcAngle});
  latest.current = {disabled,dragDisabled,onPress,onDragChange,onDrop,id,arcAngle};
  useEffect(()=>()=>latest.current.onDragChange(false),[]);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponderCapture:(_,gesture)=>!latest.current.disabled && !latest.current.dragDisabled && Math.hypot(gesture.dx,gesture.dy)>8,
    onPanResponderGrant:()=>{
      setDragging(true);
      latest.current.onDragChange(true);
      suppressedUntil.current = Number.POSITIVE_INFINITY;
    },
    onPanResponderMove:(_,gesture)=>{
      position.setValue({x:gesture.dx,y:gesture.dy});
      if(latest.current.arcAngle!==undefined)rotation.setValue(cardDragAngle(latest.current.arcAngle,gesture.dx,gesture.dy));
    },
    onPanResponderRelease:(_,gesture)=>{
      if (!latest.current.disabled && !latest.current.dragDisabled) latest.current.onDrop(latest.current.id,gesture.moveX,gesture.moveY);
      rotation.setValue(latest.current.arcAngle ?? 0); position.setValue({x:0,y:0}); setDragging(false);
      latest.current.onDragChange(false); suppressedUntil.current=Date.now()+250;
    },
    onPanResponderTerminate:()=>{
      rotation.setValue(latest.current.arcAngle ?? 0); position.setValue({x:0,y:0}); setDragging(false);
      latest.current.onDragChange(false); suppressedUntil.current=Date.now()+250;
    },
    onPanResponderTerminationRequest:()=>false,
  })).current;
  return <Animated.View testID={testID ? `drag-${testID}` : undefined} {...responder.panHandlers} style={[{width:48,height:90,paddingTop:14}, wrapperStyle, {
    zIndex:dragging?10:0,transform:position.getTranslateTransform(),opacity:dragging?0.8:1}]}>
    <AnimatedPressable ref={node=>register(id,node as View | null)} testID={testID || `marriage-hand-card-${id}`} accessibilityRole="button"
      accessibilityLabel={label} accessibilityHint={hint} aria-pressed={selected}
      accessibilityState={{selected,disabled:pressDisabled && !allowDisabledDrag}} disabled={pressDisabled && !allowDisabledDrag} onHoverIn={onHoverIn} onHoverOut={onHoverOut}
      onPress={()=>{if(!pressDisabled && Date.now()>suppressedUntil.current)latest.current.onPress();}} style={[style,arcAngle!==undefined&&{transformOrigin:'bottom center',transform:[{rotate:rotation.interpolate({inputRange:[-90,90],outputRange:['-90deg','90deg']})}]}]}>
      {children}
    </AnimatedPressable>
  </Animated.View>;
}
