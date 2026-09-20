import { RoomSheet } from './RoomSheet';
import { ChatComposer } from './ChatComposer';
import { FormFooter } from './FormFooter';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { limitPokeText, PLAYER_PHRASE_LIMIT, POKE_TEXT_LIMIT, type PlayerPhrase } from '../multiplayer/pokes';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export function PokeComposer({ recipient, recipientName, phrases, connected, onClose, onSend, onSave }: {
  recipient: number | null; recipientName?: string; phrases: PlayerPhrase[]; connected: boolean; onClose: () => void;
  onSend: (text: string) => Promise<void>; onSave: (text: string) => Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const target = recipient === null ? 'everyone' : recipientName || `Player ${recipient}`;
  const options = [...new Set(phrases.map(p => p.text))];
  const alreadySaved = options.some(phrase => phrase.toLocaleLowerCase() === text.trim().toLocaleLowerCase());
  async function submit(save: boolean) {
    if (pending.current || !connected || !text.trim()) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (save) { await onSave(text.trim()); if (alive.current) setNotice('Saved to your phrases.'); }
      else { await onSend(text.trim()); if (alive.current) onClose(); }
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : 'Could not send your poke.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <RoomSheet visible title={recipient === null ? 'Poke the table' : `Poke ${target}`} onClose={onClose} closeLabel="Close poke composer"
    footer={<FormFooter>
      <ChatComposer value={text} onChange={value => { setText(limitPokeText(value)); setNotice(''); setError(''); }}
        onSend={() => void submit(false)} disabled={busy || !connected} editable={!busy} maxLength={POKE_TEXT_LIMIT}
        placeholder="Your own little punchline…" label={`Poke message, ${POKE_TEXT_LIMIT} characters maximum`} sendLabel={`Send poke to ${target}`} />
      <View style={styles.between}><Text style={styles.note}>{phrases.length}/{PLAYER_PHRASE_LIMIT} saved</Text>
        {!alreadySaved && <Pressable accessibilityRole="button" disabled={busy || !connected || !text.trim() || phrases.length >= PLAYER_PHRASE_LIMIT} onPress={() => void submit(true)} style={[styles.save, (busy || !connected || !text.trim() || phrases.length >= PLAYER_PHRASE_LIMIT) && { opacity: 0.45 }]}>
          <Text style={styles.saveText}>+ Save phrase</Text>
        </Pressable>}</View>
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!connected && <Text style={styles.error}>Reconnecting… send when you’re back.</Text>}
    </FormFooter>}>
      <Text style={styles.note}>{recipient === null ? 'Everyone in this room will see it.' : `Only ${target} will see this message.`}</Text>
      <View style={styles.phrases}>
        {!options.length && <Text style={styles.note}>You have no saved goofy phrases yet. Write one below and save it for this and future games.</Text>}
        {options.map(phrase => <Pressable key={phrase} accessibilityRole="button" disabled={busy} accessibilityState={{ selected: text === phrase }}
          onPress={() => { setText(phrase); setError(''); setNotice(''); }} style={[styles.chip, text === phrase && styles.selected]}>
          <Text style={[styles.chipText, text === phrase && { color: colors.text }]}>{phrase}</Text>
        </Pressable>)}
      </View>
  </RoomSheet>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  note: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, lineHeight: 18 },
  phrases: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 8 }, chip: { borderRadius: 14, backgroundColor: colors.surface, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  selected: { backgroundColor: colors.surfaceSelected }, chipText: { color: colors.text, fontSize: 12, fontFamily: fonts.medium },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, save: { minHeight: 44, justifyContent: 'center' }, saveText: { color: colors.accent, fontFamily: fonts.medium, fontSize: 12 },
  success: { color: colors.success, fontFamily: fonts.body, fontSize: 11 }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12 },
});
