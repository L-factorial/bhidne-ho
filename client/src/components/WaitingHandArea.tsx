import { View } from 'react-native';
import { HandAreaBar } from './HandAreaBar';
import { HandAreaOutline } from './HandAreaOutline';
import { useTheme } from '../theme';

export function WaitingHandArea() {
  const { colors } = useTheme();
  return <View testID="waiting-hand-area" style={{ width:'100%', alignSelf:'stretch', flexShrink:0, backgroundColor:colors.tableHeader, borderTopLeftRadius:20, borderTopRightRadius:20, overflow:'hidden' }}>
    <HandAreaBar open={false} onToggle={() => {}} disabled />
    <HandAreaOutline />
  </View>;
}
