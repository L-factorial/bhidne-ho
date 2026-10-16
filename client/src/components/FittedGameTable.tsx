import { createContext, useContext, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

const TableFitScale=createContext(1);
export const useTableFitScale=()=>useContext(TableFitScale);

/** Fit natural table geometry inside the space reserved above the collapsed hand. */
export function FittedGameTable({children,testID,onSize,contentStyle}: {
  children:ReactNode;testID?:string;onSize?:(width:number,height:number)=>void;contentStyle?:StyleProp<ViewStyle>;
}) {
  const [available,setAvailable]=useState(0),[natural,setNatural]=useState(0);
  const scale=available>0&&natural>0?Math.min(1,available/natural):1;
  return <View testID={testID} style={{flex:1,minHeight:0,minWidth:0,overflow:'hidden'}} onLayout={event=>{
    const {width,height}=event.nativeEvent.layout;setAvailable(height);onSize?.(width,height);
  }}>
    <View testID={testID?`${testID}-fitted`:undefined} onLayout={event=>setNatural(event.nativeEvent.layout.height)} style={[{
      position:'absolute',top:0,left:0,right:0,minHeight:available,transformOrigin:'top center',transform:[{scale}],
    },contentStyle]}><TableFitScale.Provider value={scale}>{children}</TableFitScale.Provider></View>
  </View>;
}
