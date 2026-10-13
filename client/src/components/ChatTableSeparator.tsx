import {View} from 'react-native';
import {useTheme} from '../theme';

/** A small table trim motif shared by lobby and room chat. */
export function ChatTableSeparator() {
  const {colors}=useTheme();
  return <View testID="chat-table-separator" accessible={false} style={{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:10}}>
    <View style={{flex:1,height:3,borderTopWidth:1,borderBottomWidth:1,borderColor:colors.tableTrim,opacity:0.65}}/>
    <View style={{width:7,height:7,transform:[{rotate:'45deg'}],backgroundColor:colors.tableTrim}}/>
    <View style={{flex:1,height:3,borderTopWidth:1,borderBottomWidth:1,borderColor:colors.tableTrim,opacity:0.65}}/>
  </View>;
}
