import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fonts, palettes, themeFamilies, useTheme, type ThemePreference } from '../theme';
import { NepaliLandscape } from './NepaliLandscape';

export function AppearanceSettings() {
  const { colors: c, mode, preference, family, setPreference, setFamily, syncStatus } = useTheme();
  const { i18n } = useTranslation();
  const ne = i18n.language.startsWith('ne');
  const names = ne ? { heritage: 'नेपाली सम्पदा', himalayan: 'हिमालय', courtyard: 'हाम्रो आँगन' }
    : { heritage: 'Heritage', himalayan: 'Himalayan', courtyard: 'Community Courtyard' };
  const descriptions = ne ? { heritage: 'न्यानो क्रीम, गाढा रातो र सुनौलो', himalayan: 'हिउँजस्तो सेतो र शान्त निलो', courtyard: 'न्यानो क्रीम र हरियो' }
    : { heritage: 'Warm ivory, crimson & antique gold', himalayan: 'Snow white, slate & mountain blue', courtyard: 'Warm cream, forest & soft mint' };
  const text = { color: c.text, fontFamily: fonts.medium };
  return <View testID="appearance-settings" style={{ gap: 14, padding: 16, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: 18, backgroundColor: c.surface }}>
    <Text accessibilityRole="header" style={[text, { fontSize: 21 }]}>{ne ? 'रूप र रङ' : 'Appearance'}</Text>
    <Text style={{ color: c.textMuted, fontFamily: fonts.body, lineHeight: 20 }}>{ne ? 'आफ्नो मनपर्ने रङ छान्नुहोस्। अर्को पटक पनि यही रूप खुल्नेछ।' : 'A familiar place to play. Choose your colors; we’ll remember them next time.'}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {(['system', 'light', 'dark'] as ThemePreference[]).map(value => <Pressable key={value} accessibilityRole="radio"
        accessibilityLabel={ne ? ({ system: 'यन्त्रअनुसार', light: 'उज्यालो', dark: 'अँध्यारो' })[value] : ({ system: 'Follow device', light: 'Light', dark: 'Dark' })[value]}
        accessibilityState={{ checked: preference === value }} onPress={() => setPreference(value)}
        style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, borderWidth: 1,
          borderColor: preference === value ? c.primary : c.border, backgroundColor: preference === value ? c.primary : c.surface }}>
        <Text style={[text, { color: preference === value ? c.onPrimary : c.text }]}>{ne ? ({ system: 'यन्त्रअनुसार', light: 'उज्यालो', dark: 'अँध्यारो' })[value] : ({ system: 'Follow device', light: 'Light', dark: 'Dark' })[value]}</Text>
      </Pressable>)}
    </View>
    {themeFamilies.map(value => {
      const preview = palettes[value][mode], selected = family === value;
      return <Pressable key={value} testID={`theme-option-${value}`} accessibilityRole="radio" accessibilityLabel={names[value]}
        accessibilityState={{ checked: selected }} onPress={() => setFamily(value)}
        style={{ borderWidth: 2, borderColor: selected ? c.accent : c.borderSubtle, borderRadius: 14, padding: 12, gap: 8, backgroundColor: preview.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 16, color: preview.text }}>{names[value]}</Text>
          {selected && <Text style={{ color: preview.accent, fontFamily: fonts.medium }}>✓ {ne ? 'छानिएको' : 'Selected'}</Text>}
        </View>
        <Text style={{ color: preview.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{descriptions[value]}</Text>
        <NepaliLandscape colors={preview} height={56} />
        <View style={{ backgroundColor: preview.surface, borderRadius: 8, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: preview.text, fontFamily: fonts.medium }}>{ne ? 'साथीहरूको टेबल' : 'Friends’ table'}</Text>
            <Text style={{ color: preview.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{ne ? 'टेबल कोड: BH123' : 'Table code: BH123'}</Text>
          </View>
          <View style={{ backgroundColor: preview.primary, borderRadius: 8, padding: 10 }}>
            <Text style={{ color: preview.onPrimary, fontFamily: fonts.medium }}>{ne ? 'खेल्नुहोस्' : 'Join'}</Text>
          </View>
        </View>
      </Pressable>;
    })}
    <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 }}>
      {ne ? ({ local: 'यस यन्त्रमा सम्झिइयो', saving: 'प्रोफाइलमा सुरक्षित गर्दै…', saved: 'तपाईंको प्रोफाइलमा सुरक्षित भयो', pending: 'प्रोफाइलसँग जोडिँदै छ। इन्टरनेट आएपछि फेरि प्रयास गरिनेछ।' })[syncStatus]
        : ({ local: 'Remembered on this device', saving: 'Saving to your profile…', saved: 'Saved to your profile', pending: 'Profile sync pending. We’ll retry when connected.' })[syncStatus]}
    </Text>
  </View>;
}
