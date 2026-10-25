import {useRef, type ReactNode} from 'react';
import {View} from 'react-native';

/** At most one mounted instance per visited tab; the parent keys this by session. */
export function RetainedLobbyTab({active,children}:{active:boolean;children:ReactNode}) {
  const visited=useRef(false);
  if(active)visited.current=true;
  if(!visited.current)return null;
  return <View style={{display:active?'flex':'none'}} accessibilityElementsHidden={!active} importantForAccessibility={active?'auto':'no-hide-descendants'}>{children}</View>;
}
