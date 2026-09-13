import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, ThemeContext, type ThemeMode } from './theme';

const key = 'bhidne.appearance';
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState<ThemeMode | null>(() => {
    try { const saved = globalThis.localStorage?.getItem(key); return saved === 'light' || saved === 'dark' ? saved : null; }
    catch { return null; }
  });
  const mode = preference || (system === 'light' ? 'light' : 'dark');
  useEffect(() => {
    if (preference) try { globalThis.localStorage?.setItem(key, preference); } catch { /* Session-only on native. */ }
  }, [preference]);
  const value = useMemo(() => ({ mode, colors: mode === 'dark' ? darkColors : lightColors,
    toggle: () => setPreference(mode === 'dark' ? 'light' : 'dark') }), [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
