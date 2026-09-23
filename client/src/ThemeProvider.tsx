import { TableThemeProvider } from './TableThemeProvider';
import { useEffect, type ReactNode } from 'react';
import { colors, ThemeContext } from './theme';

const theme = { colors };

/** The lobby keeps its Nepali design; table preferences are scoped to game views. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.themeFamily = 'heritage';
    document.documentElement.style.colorScheme = 'light';
    document.body.style.backgroundColor = colors.background;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = colors.header;
  }, []);
  return <ThemeContext.Provider value={theme}><TableThemeProvider>{children}</TableThemeProvider></ThemeContext.Provider>;
}
