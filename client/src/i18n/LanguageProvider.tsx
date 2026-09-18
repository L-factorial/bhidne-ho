import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import i18n, { deviceLanguage, type AppLanguage } from './index';

const storageKey = 'bhidne.language';
const LanguageContext = createContext({ language: 'en' as AppLanguage, setLanguage: (_: AppLanguage) => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(deviceLanguage);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(storageKey).then(saved => {
      if (mounted && (saved === 'en' || saved === 'ne')) setLanguageState(saved);
    }).catch(() => {}).finally(() => { if (mounted) setHydrated(true); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    void i18n.changeLanguage(language);
    if (hydrated) void AsyncStorage.setItem(storageKey, language).catch(() => {});
  }, [hydrated, language]);
  const value = useMemo(() => ({ language, setLanguage: setLanguageState }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
