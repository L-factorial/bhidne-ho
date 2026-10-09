import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Animated, PanResponder, Pressable, type StyleProp, type View, type ViewStyle} from 'react-native';

/** A drag takes over only after movement, leaving ordinary card taps intact. */
export function MarriageHandCard({id, disabled, dragDisabled, selected, label, hint, style, children, register, onPress, onDragChange, onDrop, wrapperStyle, testID, pressDisabled = disabled, onHoverIn, onHoverOut}: {
  onHoverIn?:()=>void; onHoverOut?:()=>void;
  wrapperStyle?:StyleProp<ViewStyle>; testID?:string; pressDisabled?:boolean;
  id:string; disabled:boolean; dragDisabled:boolean; selected:boolean; label:string; hint?:string;
  style:StyleProp<ViewStyle>; children:ReactNode;
  register:(id:string, node:View|null)=>void;
  onPress:()=>void; onDragChange:(dragging:boolean)=>void;
  onDrop:(id:string, x:number, y:number)=>void;
}) {
  const position = useRef(new Animated.ValueXY()).current;
  const [dragging,setDragging] = useState(false);
  const suppressedUntil = useRef(0);
  const latest = useRef({disabled,dragDisabled,onPress,onDragChange,onDrop,id});
  latest.current = {disabled,dragDisabled,onPress,onDragChange,onDrop,id};
  useEffect(()=>()=>latest.current.onDragChange(false),[]);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponderCapture:(_,gesture)=>!latest.current.disabled && !latest.current.dragDisabled && Math.hypot(gesture.dx,gesture.dy)>8,
    onPanResponderGrant:()=>{
      setDragging(true);
      latest.current.onDragChange(true);
      suppressedUntil.current = Number.POSITIVE_INFINITY;
    },
    onPanResponderMove:(_,gesture)=>position.setValue({x:gesture.dx,y:gesture.dy}),
    onPanResponderRelease:(_,gesture)=>{
      if (!latest.current.disabled && !latest.current.dragDisabled) latest.current.onDrop(latest.current.id,gesture.moveX,gesture.moveY);
      position.setValue({x:0,y:0}); setDragging(false);
      latest.current.onDragChange(false); suppressedUntil.current=Date.now()+250;
    },
    onPanResponderTerminate:()=>{
      position.setValue({x:0,y:0}); setDragging(false);
      latest.current.onDragChange(false); suppressedUntil.current=Date.now()+250;
    },
    onPanResponderTerminationRequest:()=>false,
  })).current;
  return <Animated.View testID={testID ? `drag-${testID}` : undefined} {...responder.panHandlers} style={[{width:48,height:90,paddingTop:14}, wrapperStyle, {
    zIndex:dragging?10:0,transform:position.getTranslateTransform(),opacity:dragging?0.8:1}]}>
    <Pressable ref={node=>register(id,node)} testID={testID || `marriage-hand-card-${id}`} accessibilityRole="button"
      accessibilityLabel={label} accessibilityHint={hint} aria-pressed={selected}
      accessibilityState={{selected,disabled:pressDisabled}} disabled={pressDisabled} onHoverIn={onHoverIn} onHoverOut={onHoverOut}
      onPress={()=>{if(Date.now()>suppressedUntil.current)latest.current.onPress();}} style={style}>
      {children}
    </Pressable>
  </Animated.View>;
}
