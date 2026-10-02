import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { sharedRequest } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { ui } from '../i18n/copy';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { fonts, useTheme } from '../theme';
import { RoomSheet } from './RoomSheet';

const changes = new Set<(token: string) => void>();
function changed(session: Session) { changes.forEach(listener => listener(session.token)); }
export function useBlocking(session: Session) {
  const [enabled, setEnabled] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setEnabled(false); setReporting(false);
    void sharedRequest<{blocking: boolean; reporting?: boolean}>('/auth/safety/capabilities', session, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) {setEnabled(value.blocking);setReporting(!!value.reporting);} }).catch(() => {});
    const listener = (token: string) => { if (token === session.token) setRevision(value => value + 1); };
    changes.add(listener);
    return () => { controller.abort(); changes.delete(listener); };
  }, [session.token]);
  return { enabled, reporting, revision };
}
function Button({ text, onPress, disabled = false, label }: {text: string; onPress: () => void; disabled?: boolean; label?: string}) {
  const { colors: c } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label || text} accessibilityState={{disabled}} disabled={disabled}
    onPress={onPress} style={{paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 10, opacity: disabled ? 0.5 : 1}}>
    <Text style={{color: c.text, fontFamily: fonts.medium}}>{text}</Text>
  </Pressable>;
}
export function BlockPlayerButton({session, player, enabled, onBlocked, renderTrigger}: {
  session: Session; player: {user_id: string; display_name: string}; enabled: boolean; onBlocked?: () => void; renderTrigger?: (open:()=>void)=>ReactNode;
}) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  async function block() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await sharedRequest(`/me/blocks/${encodeURIComponent(player.user_id)}`, session, {});
      changed(session); setOpen(false); onBlocked?.();
    } catch { setError(ui('safety.failed')); }
    finally { pending.current = false; setBusy(false); }
  }
  const launch=()=>{setError('');setOpen(true);};
  if (!enabled || player.user_id === session.user_id) return renderTrigger ? <>{renderTrigger(()=>{})}</> : null;
  return <>
    {renderTrigger ? renderTrigger(launch) : <Button text={ui('safety.block')} label={ui('safety.block_player', {name: player.display_name})} onPress={launch} />}
    {open && <RoomSheet visible presentation="dialog" title={ui('safety.block_player', {name: player.display_name})} onClose={() => { if (!busy) setOpen(false); }}>
      <Text style={{color: c.text, fontFamily: fonts.body}}>{ui('safety.explanation')}</Text>
      {!!error && <Text accessibilityRole="alert" style={{color: c.danger}}>{error}</Text>}
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 12}}>
        <Button text={ui('safety.confirm')} disabled={busy} onPress={() => void block()} />
        <Button text={ui('safety.cancel')} disabled={busy} onPress={() => setOpen(false)} />
      </View>
    </RoomSheet>}
  </>;
}
type Player = {user_id: string; display_name: string; username: string | null};
type Page = {items: Player[]; next_id: string | null};
export function BlockedPlayers({session}: {session: Session}) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const { enabled, revision } = useBlocking(session);
  const [open, setOpen] = useState(false), [page, setPage] = useState<Page>({items: [], next_id: null});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open || !enabled) return;
    const controller = new AbortController(); lifetime.current = controller;
    setBusy(true); setError(''); setPage({items: [], next_id: null});
    void sharedRequest<Page>('/me/blocks', session, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(value); })
      .catch(() => { if (!controller.signal.aborted) setError(ui('safety.load_failed')); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, enabled, session.token, revision, refresh]);
  async function more() {
    if (busy || !page.next_id) return;
    const signal = lifetime.current?.signal;
    setBusy(true); setError('');
    try {
      const result = await sharedRequest<Page>(`/me/blocks?after=${encodeURIComponent(page.next_id)}`, session, undefined, signal);
      if (!signal?.aborted) setPage(old => ({items: [...old.items, ...result.items.filter(p => !old.items.some(o => o.user_id === p.user_id))], next_id: result.next_id}));
    } catch { if (!signal?.aborted) setError(ui('safety.load_failed')); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  async function unblock(player: Player) {
    if (busy) return;
    const signal = lifetime.current?.signal;
    setBusy(true); setError('');
    try {
      await sharedRequest(`/me/blocks/${encodeURIComponent(player.user_id)}`, session, undefined, signal, 'DELETE');
      if (!signal?.aborted) changed(session);
    } catch { if (!signal?.aborted) setError(ui('safety.failed')); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  if (!enabled) return null;
  return <View style={{gap: 12}}>
    <Button text={ui('safety.manage')} onPress={() => setOpen(true)} />
    {open && <RoomSheet visible title={ui('safety.blocked_players')} onClose={() => setOpen(false)}>
      <Text style={{color: c.textMuted, fontFamily: fonts.body}}>{ui('safety.unblock_help')}</Text>
      {!!error && <><Text accessibilityRole="alert" style={{color: c.danger}}>{error}</Text><Button text={ui('safety.retry')} disabled={busy} onPress={() => setRefresh(v => v + 1)} /></>}
      {busy && <Text accessibilityLiveRegion="polite" style={{color: c.text}}>{ui('safety.loading')}</Text>}
      {!busy && !error && !page.items.length && <Text style={{color: c.text}}>{ui('safety.empty')}</Text>}
      {page.items.map(player => <View key={player.user_id} style={{flexDirection: 'row', gap: 12, alignItems: 'center'}}>
        <Text style={{flex: 1, color: c.text, fontFamily: fonts.body}}>{player.display_name || player.username || player.user_id}</Text>
        <Button text={ui('safety.unblock')} label={`${ui('safety.unblock')} ${player.display_name || player.username || player.user_id}`} disabled={busy} onPress={() => void unblock(player)} />
      </View>)}
      {!!page.next_id && <Button text={ui('safety.load_more')} disabled={busy} onPress={() => void more()} />}
    </RoomSheet>}
  </View>;
}
