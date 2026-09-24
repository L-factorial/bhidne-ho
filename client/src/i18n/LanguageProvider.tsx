import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import i18n, { defaultLanguage, type AppLanguage } from './index';

const storageKey = 'bhidne.language';
const LanguageContext = createContext({ language: defaultLanguage, setLanguage: (_: AppLanguage) => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(defaultLanguage);
  const [hydrated, setHydrated] = useState(false);
  const changed = useRef(false);
  const writes = useRef(Promise.resolve());
  const setLanguage = useCallback((next: AppLanguage) => {
    changed.current = true;
    void i18n.changeLanguage(next);
    setLanguageState(next);
  }, []);
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(storageKey).then(saved => {
      if (mounted && !changed.current && (saved === 'en' || saved === 'ne')) setLanguageState(saved);
    }).catch(() => {}).finally(() => { if (mounted) setHydrated(true); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    void i18n.changeLanguage(language);
    if (hydrated) writes.current = writes.current.then(() => AsyncStorage.setItem(storageKey, language)).catch(() => {});
  }, [hydrated, language]);
  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
