import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, useColorScheme, View } from 'react-native';
import { apiUrl, request } from './multiplayer/api';
import { readSession, type Session } from './multiplayer/session';
import { palettes, ThemeContext, validAppearance, type Appearance, type ThemeFamily, type ThemePreference } from './theme';

const lastKey = 'bhidne.appearance.v2';
const accountKey = (session: Session) => `${lastKey}:${apiUrl}:${session.user_id}`;
type Cached = Appearance & { pending?: boolean };
const defaults: Cached = { theme: 'heritage', mode: 'system' };
function parse(raw: string | null): Cached | null {
  try { const value = JSON.parse(raw || 'null'); return validAppearance(value) ? value : null; } catch { return null; }
}
function initial(): Cached {
  try {
    const session = readSession(apiUrl)?.session;
    const saved = parse(globalThis.localStorage?.getItem(session ? accountKey(session) : lastKey));
    if (saved) return saved;
    const legacy = globalThis.localStorage?.getItem('bhidne.appearance');
    return !session && (legacy === 'light' || legacy === 'dark') ? { ...defaults, mode: legacy } : defaults;
  } catch { return defaults; }
}
// Serialize disk writes so a slower, older save cannot replace the latest choice.
let storageQueue = Promise.resolve();
function persist(value: Cached, session: Session | null) {
  const pairs: [string, string][] = [[lastKey, JSON.stringify(value)], ['bhidne.appearance', value.mode]];
  if (session) pairs.push([accountKey(session), JSON.stringify(value)]);
  storageQueue = storageQueue.catch(() => {}).then(() => AsyncStorage.multiSet(pairs));
  return storageQueue;
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [appearance, setAppearance] = useState<Cached>(initial);
  const [session, setSession] = useState<Session | null>(() => readSession(apiUrl)?.session || null);
  const [ready, setReady] = useState(Platform.OS === 'web');
  const [syncStatus, setSyncStatus] = useState<'local' | 'saving' | 'saved' | 'pending'>('local');
  const current = useRef(appearance);
  const changeVersion = useRef(0);
  const syncNow = useRef<() => void>(() => {});
  const bindSession = useCallback((next: Session | null) => setSession(previous =>
    previous?.token === next?.token && previous?.user_id === next?.user_id ? previous : next), []);

  useEffect(() => {
    let active = true, busy = false, loaded = false, fetched = false;
    const startVersion = changeVersion.current;
    async function sync() {
      if (!active || !loaded || busy || !session || (fetched && !current.current.pending)) return;
      busy = true;
      const version = changeVersion.current;
      const snapshot = current.current;
      setSyncStatus('saving');
      try {
        const result = snapshot.pending
          ? await request<Appearance>('/me/profile/appearance', session, { theme: snapshot.theme, mode: snapshot.mode }, undefined, 'PATCH')
          : await request<Appearance>('/me/profile/appearance', session);
        if (!validAppearance(result)) throw new Error('Invalid appearance');
        if (!active) return;
        fetched = true;
        if (version === changeVersion.current) {
          const saved = { ...result, pending: false };
          current.current = saved; setAppearance(saved);
          await persist(saved, session);
          if (active && version === changeVersion.current) setSyncStatus('saved');
        }
      } catch { if (active) setSyncStatus('pending'); }
      finally {
        busy = false;
        if (active && version !== changeVersion.current) void sync();
      }
    }
    syncNow.current = () => { void sync(); };
    void (async () => {
      try {
        const cached = parse(await AsyncStorage.getItem(session ? accountKey(session) : lastKey));
        if (!active) return;
        if (startVersion === changeVersion.current) {
          const next = cached || (session ? defaults : current.current);
          current.current = next; setAppearance(next);
        }
      } catch {
        // Never inherit another account's selection when device storage is blocked.
        if (active && session && startVersion === changeVersion.current) {
          current.current = defaults; setAppearance(defaults);
        }
      }
      if (!active) return;
      loaded = true; setReady(true); setSyncStatus(session ? 'saving' : 'local');
      void sync();
    })();
    const timer = setInterval(() => { void sync(); }, 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    const online = () => { void sync(); };
    if (Platform.OS === 'web') globalThis.addEventListener('online', online);
    return () => {
      active = false; clearInterval(timer); subscription.remove();
      if (Platform.OS === 'web') globalThis.removeEventListener('online', online);
    };
  }, [session?.user_id, session?.token]);

  const update = useCallback((patch: Partial<Appearance>) => {
    const next = { ...current.current, ...patch, pending: !!session };
    changeVersion.current += 1; current.current = next; setAppearance(next);
    setSyncStatus(session ? 'saving' : 'local');
    void persist(next, session).catch(() => { setSyncStatus('pending'); });
    syncNow.current();
  }, [session]);
  const preference = appearance.mode, family = appearance.theme;
  const mode = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const colors = palettes[family][mode];
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.themeFamily = family;
    document.documentElement.style.colorScheme = mode;
    document.body.style.backgroundColor = colors.background;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = colors.header;
  }, [mode, family, colors]);
  const value = useMemo(() => ({ mode, colors, preference, family, bindSession, syncStatus,
    setPreference: (mode: ThemePreference) => update({ mode }), setFamily: (theme: ThemeFamily) => update({ theme }),
    toggle: () => update({ mode: mode === 'dark' ? 'light' : 'dark' }),
  }), [mode, colors, preference, family, bindSession, syncStatus, update]);
  return <ThemeContext.Provider value={value}>{ready ? children : <View style={{ flex: 1, backgroundColor: colors.background }} />}</ThemeContext.Provider>;
}
