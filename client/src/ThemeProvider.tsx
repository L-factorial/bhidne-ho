import { TableThemeProvider, useTableTheme } from './TableThemeProvider';
import { useEffect, type ReactNode } from 'react';
import { ThemeContext } from './theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <TableThemeProvider><SelectedTheme>{children}</SelectedTheme></TableThemeProvider>;
}

function SelectedTheme({ children }: { children: ReactNode }) {
  const { id, theme } = useTableTheme();
  const { colors } = theme;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.themeFamily = id;
    document.documentElement.style.colorScheme = 'dark';
    document.body.style.backgroundColor = colors.background;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = colors.header;
  }, [id, colors]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
