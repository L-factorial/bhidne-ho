import { BlockedPlayers } from '../components/PlayerBlocking';
import { DeleteAccountLink } from './DeletionScreen';
import { RecoveryEmailSettings } from './RecoveryScreen';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui } from '../i18n/copy.ts';
import { gameControlFinish, gameHeadingFinish, fonts, useThemedStyles, type ThemeColors } from '../theme';
import { FormScrollView } from '../components/FormInput';
import { KeyboardFrame } from '../components/KeyboardFrame';
import { useEffect, useState } from 'react';
import { request } from '../multiplayer/api';
import { AppHeader } from '../components/AppHeader';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DisplayNameField } from '../components/DisplayNameField';
import type { Session } from '../multiplayer/session';
import { PlayerPhrases } from '../components/PlayerPhrases';
import type { usePlayerPhrases } from '../multiplayer/usePlayerPhrases';
import { FriendsPanel } from '../components/FriendsPanel';

export function ProfileScreen({ session, personal, onBack, onSignOut }: {
  session: Session; personal: ReturnType<typeof usePlayerPhrases>; onBack: () => void; onSignOut?: () => void;
}) {
  useUiLanguage();
  const styles = useThemedStyles(createStyles);
  const userId = session.user_id;
  const insets = useSafeAreaInsets();
  const [identity, setIdentity] = useState<{ user_id: string; display_name: string; username?: string | null } | null>(null);
  const [identityError, setIdentityError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setIdentity(null); setIdentityError('');
    void request<{ user_id: string; display_name: string; username?: string | null }>('/auth/me', session, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setIdentity(value); })
      .catch(() => { if (!controller.signal.aborted) setIdentityError(ui("feedback.profile_load_help")); });
    return () => controller.abort();
  }, [userId, session.token]);
  return <KeyboardFrame><FormScrollView testID="profile-screen" accessibilityViewIsModal style={styles.page} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: 20, paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }}>
    <View style={styles.content}>
      <AppHeader title={ui("common.your_profile_title")} hideProfile inlineActions={<Pressable accessibilityRole="button" accessibilityLabel={ui("common.back_from_profile")} onPress={onBack} style={styles.back}><Text style={styles.link}>{ui("common.back_label")}</Text></Pressable>} />
      <View testID="profile-identity" style={{ gap: 6, paddingVertical: 12 }}>
        <Text accessibilityRole="header" style={styles.title}>{identity?.display_name || identity?.username || (identityError ? ui("common.account_label") : ui("common.loading_profile"))}</Text>
        {!!identity?.username && <Text style={styles.description}>@{identity.username}</Text>}
        <Text selectable accessibilityLabel={ui("common.profile_id", {id: userId})} style={styles.description}>{ui("common.profile_id", {id: userId})}</Text>
        {!!identityError && <Text accessibilityRole="alert" style={styles.description}>{identityError}</Text>}
      </View>
      <DisplayNameField session={session} onSaved={display_name => setIdentity(current => current ? { ...current, display_name } : { user_id: userId, display_name })} />
      <RecoveryEmailSettings session={session} /><BlockedPlayers session={session} />
      <DeleteAccountLink />
      <FriendsPanel session={session} />
      <PlayerPhrases key={userId} userId={userId} phrases={personal.phrases} connected={true}
        loadError={personal.error} onSave={personal.save} onRemove={personal.remove} onUpdate={personal.update} />
      <Text style={styles.description}>{ui("social.phrase_edit_help")}</Text>
      {onSignOut && <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOut}><Text style={styles.signOutText}>{ui("common.sign_out_label")}</Text></Pressable>}
    </View>
  </FormScrollView></KeyboardFrame>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 16 },
  title: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 36, color: colors.text },
  back: { ...gameControlFinish(colors), minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  link: { fontFamily: fonts.medium, color: colors.accent, fontSize: 14 },
  signOut: { ...gameControlFinish(colors), minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, signOutText: { fontFamily: fonts.medium, color: colors.textMuted, fontSize: 13 },
  description: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 22 },
});
