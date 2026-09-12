import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { limitPokeText, pokeTextLength, type PlayerPhrase } from '../multiplayer/pokes';
import { colors, fonts } from '../theme';

export function PlayerPhrases({ phrases, userId, connected, loadError, onSave, onRemove }: {
  phrases: PlayerPhrase[]; userId: string; connected: boolean; loadError: string;
  onSave: (text: string) => Promise<void>; onRemove: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(true), [text, setText] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function change(id?: string) {
    if (pending.current || !connected || (!id && !text.trim())) return;
    pending.current = true; setBusy(true); setError('');
    try { if (id) await onRemove(id); else { await onSave(text.trim()); setText(''); } }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update punchlines.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <View style={styles.panel}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.toggle}>
      <Text style={styles.title}>My goofy phrases · {phrases.length}</Text><Text style={styles.title}>{open ? '−' : '+'}</Text>
    </Pressable>
    {open && <View style={styles.body}>
      <Text style={styles.note}>Your keywords. Your inside jokes. Create phrases up to 25 characters. Use them later in any Call Break room by tapping a player or the card area.</Text>
      <View style={styles.phrases}>{phrases.map(phrase => <View key={phrase.id} style={styles.chip}>
        <Text style={styles.phrase}>{phrase.text}</Text>
        {phrase.created_by === userId && <Pressable accessibilityRole="button" accessibilityLabel={`Remove punchline ${phrase.text}`}
          disabled={busy || !connected} onPress={() => void change(phrase.id)} style={styles.remove}><Text style={styles.removeText}>×</Text></Pressable>}
      </View>)}</View>
      <TextInput accessibilityLabel="New personal phrase, 25 characters maximum" value={text} onChangeText={value => setText(limitPokeText(value))}
        maxLength={50} editable={!busy && connected} placeholder="A keyword or punchline…" placeholderTextColor={colors.muted} style={styles.input}
        returnKeyType="done" onSubmitEditing={() => void change()} />
      <View style={styles.toggle}><Text style={styles.note}>{pokeTextLength(text)}/25 · Only you can see your collection</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Save personal phrase" disabled={busy || !connected || !text.trim()}
          onPress={() => void change()} style={[styles.add, (busy || !connected || !text.trim()) && { opacity: 0.45 }]}><Text style={styles.addText}>{busy ? 'Saving…' : 'Save'}</Text></Pressable></View>
      {!!(error || loadError) && <Text accessibilityRole="alert" style={styles.error}>{error || loadError}</Text>}
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { backgroundColor: colors.ivory, borderRadius: 16, padding: 20, marginTop: 20 }, toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, gap: 8 },
  title: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink }, body: { gap: 8, paddingBottom: 8 }, note: { fontFamily: fonts.body, color: colors.muted, fontSize: 11, lineHeight: 19 },
  phrases: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E9E0D4', borderRadius: 12, paddingLeft: 12, paddingRight: 8, minHeight: 44, maxWidth: '100%' },
  phrase: { fontFamily: fonts.medium, color: colors.ink, fontSize: 12, flexShrink: 1 }, remove: { minWidth: 38, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, removeText: { color: colors.copper, fontSize: 23 },
  input: { backgroundColor: '#FFFFFF', borderRadius: 9, borderWidth: 1, borderColor: colors.line, padding: 12, minHeight: 46, fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  add: { minHeight: 44, minWidth: 66, backgroundColor: colors.copper, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }, addText: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 12 },
  error: { color: '#A33332', fontFamily: fonts.body, fontSize: 12 },
});
