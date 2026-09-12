import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { limitPokeText, pokeTextLength, QUICK_POKES, type PlayerPhrase } from '../multiplayer/pokes';
import { colors, fonts } from '../theme';

export function PokeComposer({ recipient, phrases, connected, onClose, onSend, onSave }: {
  recipient: number | null; phrases: PlayerPhrase[]; connected: boolean; onClose: () => void;
  onSend: (text: string) => Promise<void>; onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    // Consume keyup before the enclosing game modal can also handle Escape.
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    if (Platform.OS === 'web') globalThis.addEventListener('keyup', escape, true);
    return () => { subscription.remove(); if (Platform.OS === 'web') globalThis.removeEventListener('keyup', escape, true); };
  }, [onClose]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const target = recipient === null ? 'everyone' : `Player ${recipient}`;
  const options = [...new Set([...phrases.map(p => p.text), ...QUICK_POKES])];
  async function submit(save: boolean) {
    if (pending.current || !connected || !text.trim()) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (save) { await onSave(text.trim()); if (alive.current) setNotice('Saved to your phrases.'); }
      else { await onSend(text.trim()); if (alive.current) onClose(); }
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : 'Could not send your poke.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Pressable accessibilityLabel="Close poke composer" onPress={onClose} style={StyleSheet.absoluteFill} />
    <View accessibilityViewIsModal style={styles.sheet}>
      <View style={styles.header}><View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>{recipient === null ? 'TO THE WHOLE TABLE' : 'PRIVATE POKE'}</Text>
        <Text accessibilityRole="header" style={styles.title}>{recipient === null ? 'Make the table laugh.' : `Poke Player ${recipient}`}</Text>
      </View><Pressable accessibilityRole="button" accessibilityLabel="Close poke composer" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable></View>
      <Text style={styles.note}>{recipient === null ? 'Everyone in this room will see it.' : `Only Player ${recipient} will see this message.`}</Text>
      <ScrollView style={{ maxHeight: 190 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.phrases}>
        {options.map(phrase => <Pressable key={phrase} accessibilityRole="button" accessibilityState={{ selected: text === phrase }}
          onPress={() => { setText(phrase); setError(''); setNotice(''); }} style={[styles.chip, text === phrase && styles.selected]}>
          <Text style={[styles.chipText, text === phrase && { color: colors.ivory }]}>{phrase}</Text>
        </Pressable>)}
      </ScrollView>
      <TextInput accessibilityLabel="Poke message, 25 characters maximum" placeholder="Your own little punchline…" placeholderTextColor="#74838C"
        value={text} onChangeText={value => { setText(limitPokeText(value)); setNotice(''); setError(''); }}
        style={styles.input} maxLength={50} editable={!busy} returnKeyType="send" onSubmitEditing={() => void submit(false)} />
      <View style={styles.between}><Text style={styles.note}>{pokeTextLength(text)}/25 characters</Text>
        <Pressable accessibilityRole="button" disabled={busy || !connected || !text.trim()} onPress={() => void submit(true)} style={styles.save}>
          <Text style={styles.saveText}>+ Save to my phrases</Text>
        </Pressable></View>
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!connected && <Text style={styles.error}>Reconnecting… send when you’re back.</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Send poke to ${target}`} disabled={busy || !connected || !text.trim()}
        onPress={() => void submit(false)} style={[styles.send, (busy || !connected || !text.trim()) && { opacity: 0.45 }]}>
        <Text style={styles.sendText}>{busy ? 'One moment…' : `Send to ${target} ↗`}</Text>
      </Pressable>
    </View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 30, backgroundColor: '#071520B8', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 430, maxHeight: '95%', borderRadius: 22, padding: 20, backgroundColor: colors.ivory, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, eyebrow: { fontFamily: fonts.medium, color: colors.copper, fontSize: 9, letterSpacing: 1.5 },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 29, marginTop: 5 }, note: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, lineHeight: 18 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, closeText: { color: colors.ink, fontSize: 29 },
  phrases: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 8 }, chip: { borderRadius: 14, backgroundColor: '#E6E1D7', paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  selected: { backgroundColor: colors.ink }, chipText: { color: colors.ink, fontSize: 12, fontFamily: fonts.medium },
  input: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, minHeight: 48, fontSize: 15, fontFamily: fonts.body, color: colors.ink },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, save: { minHeight: 44, justifyContent: 'center' }, saveText: { color: colors.copper, fontFamily: fonts.medium, fontSize: 12 },
  send: { minHeight: 48, borderRadius: 12, backgroundColor: colors.copper, alignItems: 'center', justifyContent: 'center' }, sendText: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 13 },
  success: { color: '#256D59', fontFamily: fonts.body, fontSize: 11 }, error: { color: '#A33332', fontFamily: fonts.body, fontSize: 12 },
});
