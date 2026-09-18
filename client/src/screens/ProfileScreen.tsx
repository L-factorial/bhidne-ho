import { AppHeader } from '../components/AppHeader';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DisplayNameField } from '../components/DisplayNameField';
import type { Session } from '../multiplayer/session';
import { PlayerPhrases } from '../components/PlayerPhrases';
import type { usePlayerPhrases } from '../multiplayer/usePlayerPhrases';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';
import { FriendsPanel } from '../components/FriendsPanel';

export function ProfileScreen({ session, personal, onBack, onSignOut }: {
  session: Session; personal: ReturnType<typeof usePlayerPhrases>; onBack: () => void; onSignOut?: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const userId = session.user_id;
  const insets = useSafeAreaInsets();
  return <ScrollView testID="profile-screen" accessibilityViewIsModal style={styles.page} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: 20, paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }}>
    <View style={styles.content}>
      <AppHeader title="Your profile" hideProfile actions={<Pressable accessibilityRole="button" accessibilityLabel="Back from profile" onPress={onBack} style={styles.back}><Text style={styles.link}>Back</Text></Pressable>} />
      <Text style={styles.description}>Make your table talk your own. Your saved phrases are private to you.</Text>
      <DisplayNameField session={session} />
      {onSignOut && <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOut}><Text style={styles.signOutText}>Sign out</Text></Pressable>}
      <FriendsPanel session={session} />
      <PlayerPhrases key={userId} userId={userId} phrases={personal.phrases} connected={true}
        loadError={personal.error} onSave={personal.save} onRemove={personal.remove} onUpdate={personal.update} />
      <Text style={styles.description}>Tap a saved phrase to edit it. During any game, open Poke the table to choose a saved phrase or add a new one without leaving the table.</Text>
    </View>
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { fontFamily: fonts.display, fontSize: 36, color: colors.text },
  back: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  link: { fontFamily: fonts.medium, color: colors.accent, fontSize: 14 },
  signOut: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, signOutText: { fontFamily: fonts.medium, color: colors.textMuted, fontSize: 13 },
  description: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 22 },
});
