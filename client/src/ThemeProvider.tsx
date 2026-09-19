import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, ThemeContext, type ThemePreference } from './theme';

const key = 'bhidne.appearance';
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try { const saved = globalThis.localStorage?.getItem(key); return saved === 'light' || saved === 'dark' ? saved : 'system'; }
    catch { return 'system'; }
  });
  const mode = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const colors = mode === 'dark' ? darkColors : lightColors;
  useEffect(() => {
    try { globalThis.localStorage?.setItem(key, preference); } catch { /* Session-only on native. */ }
  }, [preference]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    document.body.style.backgroundColor = colors.background;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = colors.header;
  }, [mode, colors]);
  const value = useMemo(() => ({ mode, colors, preference, setPreference,
    toggle: () => setPreference(mode === 'dark' ? 'light' : 'dark') }), [mode, colors, preference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
