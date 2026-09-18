import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { resources } from './resources';

export type AppLanguage = 'en' | 'ne';
export const deviceLanguage = (): AppLanguage => getLocales()[0]?.languageCode === 'ne' ? 'ne' : 'en';

void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'ne'],
  interpolation: { escapeValue: false },
});

export default i18n;
