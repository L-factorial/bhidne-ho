import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cardThemeStorageKey, defaultCardTheme, isCardThemeId, type CardThemeId } from './cardThemeCatalog';

type CardThemeChoice = { id: CardThemeId; select: (id: CardThemeId) => void; canSelect: boolean; shared: boolean; pending: boolean };
const CardThemeContext = createContext<CardThemeChoice>({ id: defaultCardTheme, select: () => {}, canSelect: false, shared: true, pending: false });
const DeviceCardThemeContext = createContext<CardThemeChoice>({ id: defaultCardTheme, select: () => {}, canSelect: false, shared: false, pending: false });
/** Device-local artwork default used when creating the next table. */
export function CardThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<CardThemeId>(defaultCardTheme);
  const [ready, setReady] = useState(false);
  const changed = useRef(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(cardThemeStorageKey).then(saved => {
      if (active && !changed.current && isCardThemeId(saved)) setId(saved);
    }).catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (ready) writes.current = writes.current.then(() => AsyncStorage.setItem(cardThemeStorageKey, id)).catch(() => {});
  }, [id, ready]);
  const value: CardThemeChoice = { id, canSelect: true, shared: false, pending: false, select: next => { changed.current = true; setId(next); } };
  return <DeviceCardThemeContext.Provider value={value}><CardThemeContext.Provider value={value}>{ready ? children : null}</CardThemeContext.Provider></DeviceCardThemeContext.Provider>;
}
export const useCardTheme = () => useContext(CardThemeContext);
export const useDeviceCardTheme = () => useContext(DeviceCardThemeContext);

/** Authoritative table projection overrides the device's next-table default. */
export function TableCardThemeProvider({ id, canChange, pending, select, children }: {
  id: unknown; canChange: boolean; pending: boolean; select: (id: CardThemeId) => void; children: ReactNode;
}) {
  const value: CardThemeChoice = { id: isCardThemeId(id) ? id : defaultCardTheme,
    canSelect: canChange, shared: true, pending, select: next => { if (canChange && !pending) select(next); } };
  return <CardThemeContext.Provider value={value}>{children}</CardThemeContext.Provider>;
}
