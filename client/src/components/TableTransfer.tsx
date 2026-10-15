import {ActivityLine} from './ActivityLine';
import {Image, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {branding} from '../branding';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {fonts,useTheme} from '../theme';

export function TableTransfer(){
  useUiLanguage();
  const {colors}=useTheme();
  const {width,height}=useWindowDimensions();
  const insets=useSafeAreaInsets();
  const artworkWidth=Math.max(0,Math.min(440,width-insets.left-insets.right-48,
    (height-insets.top-insets.bottom-132)*1090/650));
  return <View testID="table-transfer" accessibilityViewIsModal style={{position:'absolute',inset:0,
    backgroundColor:colors.background,alignItems:'center',justifyContent:'center',gap:24,zIndex:20,
    paddingTop:Math.max(24,insets.top),paddingBottom:Math.max(24,insets.bottom),
    paddingLeft:Math.max(24,insets.left),paddingRight:Math.max(24,insets.right)}}>
    <Image testID="table-transfer-art" source={branding.landing} accessibilityLabel={ui('common.brand_art')}
      resizeMode="contain" style={{width:artworkWidth,height:artworkWidth*650/1090}} />
    <View style={{alignItems:'center',gap:10}}>
      <ActivityLine />
      <Text accessibilityLiveRegion="polite" style={{color:colors.textMuted,fontFamily:fonts.body,
        fontSize:12,lineHeight:18,textAlign:'center',maxWidth:280}}>{ui('feedback.taking_you_to_table')}</Text>
    </View>
  </View>;
}
