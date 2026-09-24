import { useTranslation } from 'react-i18next';

// Also include this value in memo dependencies containing translated copy.
export function useUiLanguage() {
  return useTranslation('ui').i18n.resolvedLanguage;
}
