import i18n from './core';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

export type AppLanguage = 'en' | 'ne';
export const deviceLanguage = (): AppLanguage => getLocales()[0]?.languageCode === 'ne' ? 'ne' : 'en';

initReactI18next.init(i18n);
void i18n.changeLanguage(deviceLanguage());

export default i18n;
