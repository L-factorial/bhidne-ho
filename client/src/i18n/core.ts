import i18n from 'i18next';
import { resources } from './resources.ts';
import { uiCatalogs } from './catalogs.ts';

// Pure runtime: game presentation helpers and Node tests can use this without Expo.
void i18n.init({
  resources: {
    en: { ...resources.en, ui: uiCatalogs.en },
    ne: { ...resources.ne, ui: uiCatalogs.ne },
  },
  lng: 'en', fallbackLng: 'en', supportedLngs: ['en', 'ne'],
  defaultNS: 'translation', interpolation: { escapeValue: false },
  initAsync: false,
});
export default i18n;
