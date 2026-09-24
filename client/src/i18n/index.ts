import i18n from './core';
import { initReactI18next } from 'react-i18next';

export type AppLanguage = 'en' | 'ne';
export const defaultLanguage: AppLanguage = 'en';

initReactI18next.init(i18n);
void i18n.changeLanguage(defaultLanguage);

export default i18n;
