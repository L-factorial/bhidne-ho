import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { isTableThemeId, tableThemes, type TableThemeId } from './tableThemes';

const storageKey = 'bhidne.table-theme.v1';
const TableThemeContext = createContext({ id: 'classic' as TableThemeId, select: (_id: TableThemeId) => {} });
export function TableThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<TableThemeId>('classic');
  const [ready, setReady] = useState(false);
  const changed = useRef(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey).then((saved: string | null) => {
      if (active && !changed.current && isTableThemeId(saved)) setId(saved);
    }).catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (ready) writes.current = writes.current.then(() => AsyncStorage.setItem(storageKey, id)).catch(() => {});
  }, [id, ready]);
  return <TableThemeContext.Provider value={{ id, select: next => { changed.current = true; setId(next); } }}>{children}</TableThemeContext.Provider>;
}
export function useTableTheme() {
  const preference = useContext(TableThemeContext);
  return { ...preference, theme: tableThemes[preference.id] };
}
