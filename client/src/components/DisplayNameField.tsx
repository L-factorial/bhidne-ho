import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { limitPokeText, pokeTextLength } from '../multiplayer/pokes';
import { fonts, useTheme } from '../theme';

export function DisplayNameField({ session }: { session: Session }) {
  const { colors } = useTheme();
  const [name, setName] = useState(''), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setLoaded(false); setMessage('');
    request<{ display_name: string }>('/me/profile', session, undefined, controller.signal)
      .then(profile => { if (!controller.signal.aborted) { setName(profile.display_name); setLoaded(true); } })
      .catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [session.user_id, session.token]);
  async function save() {
    const signal = lifetime.current?.signal;
    if (!loaded || pending.current || !signal || signal.aborted) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      const profile = await request<{ display_name: string }>('/me/profile', session, { display_name: name }, signal, 'PATCH');
      if (!signal.aborted) { setName(profile.display_name); setMessage('Display name saved.'); }
    } catch (error) {
      if (!signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not save your name.');
    } finally { pending.current = false; if (!signal.aborted) setBusy(false); }
  }
  return <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 16, gap: 12 }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium }}>Display name</Text>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 20 }}>The name other players see at the game table. Leave it blank to use your player number.</Text>
    <TextInput accessibilityLabel="Game display name" value={name} editable={loaded && !busy} maxLength={50}
      onChangeText={value => { setName(limitPokeText(value)); setMessage(''); }} placeholder="Your name or nickname"
      placeholderTextColor={colors.textMuted} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => void save()}
      style={{ backgroundColor: colors.surface, borderRadius: 8, padding: 12, minHeight: 46, fontFamily: fonts.body, color: colors.text }} />
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{pokeTextLength(name)}/25</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Save display name" disabled={!loaded || busy} onPress={() => void save()}
      style={{ minHeight: 44, padding: 12, borderRadius: 8, alignItems: 'center', backgroundColor: colors.surfaceSelected, opacity: loaded && !busy ? 1 : 0.5 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.medium }}>{busy ? 'Saving…' : 'Save name'}</Text>
    </Pressable>
    {!!message && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>}
  </View>;
}
