import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../i18n/LanguageProvider';
import { fonts, useTheme } from '../theme';

export function LanguageToggle() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const next = language === 'en' ? 'ne' : 'en';
  const label = t(next === 'ne' ? 'language.nepali' : 'language.english');
  return <Pressable accessibilityRole="button" accessibilityLabel={t('language.switchTo', { language: label })}
    onPress={() => setLanguage(next)} style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 10, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
    <Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: 12 }}>{label}</Text>
  </Pressable>;
}
