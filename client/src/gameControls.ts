import type {ThemeColors} from './theme';
import {radii} from './theme';
export type GameControlVariant='primary'|'secondary'|'destructive'|'selected';
export const gameControlText=(variant:GameControlVariant='secondary',disabled=false)=>disabled?'#a5aec0':variant==='primary'?'#20202a':variant==='destructive'?'#ffb9c6':variant==='selected'?'#f7d66f':'#fff7e6';
/** Game actions only. Eligibility/glow panels retain their existing treatment. */
export function gameControlStyle(_colors:ThemeColors,variant:GameControlVariant='secondary',pressed=false,disabled=false){
 return {minHeight:44,minWidth:44,borderRadius:radii.medium,borderWidth:1,paddingHorizontal:12,paddingVertical:10,
  backgroundColor:disabled?'#303b51':variant==='primary'?(pressed?'#d6ad39':'#edc44f'):variant==='destructive'?'#1b263e':pressed?'#304463':'#263650',
  borderColor:disabled?'#566178':variant==='primary'||variant==='selected'?'#edc44f':variant==='destructive'?'#e78ba0':'#8293b4',
  boxShadow:'none' as const};
}
