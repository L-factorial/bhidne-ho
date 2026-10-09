import {AppText as Text} from '../components/AppText';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeAction } from '../components/ThemeAction';
import {PushSettings} from '../notifications/PushSettings';
import { PolicyLinks } from '../components/moderation/PublicPolicies';
import { CommunityRulesEntry } from '../components/moderation/CommunityRules';
import { ModerationEntry } from '../components/Moderation';
import { BlockedPlayers } from '../components/PlayerBlocking';
import { DeleteAccountLink } from './DeletionScreen';
import { RecoveryEmailSettings } from './RecoveryScreen';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui } from '../i18n/copy.ts';
import { radii, gameControlFinish, gameHeadingFinish, fonts, useThemedStyles, type ThemeColors } from '../theme';
import { FormScrollView } from '../components/FormInput';
import { KeyboardFrame } from '../components/KeyboardFrame';
import { useContext, useEffect, useState } from 'react';
import { ProfileDismissal } from '../components/ProfileModal';
import { request } from '../multiplayer/api';
import { AppHeader } from '../components/AppHeader';
import { Ionicons } from '@expo/vector-icons';
import {Pressable, StyleSheet, View} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DisplayNameField } from '../components/DisplayNameField';
import type { Session } from '../multiplayer/session';
import type { usePlayerPhrases } from '../multiplayer/usePlayerPhrases';
import { FriendsPanel } from '../components/FriendsPanel';
import { CreateCardThemeSelector } from '../components/CardThemePicker';

export function ProfileScreen({ session, onBack, onSignOut }: {
  session: Session; personal: ReturnType<typeof usePlayerPhrases>; onBack: () => void; onSignOut?: () => void;
}) {
  useUiLanguage();
  const afterDismiss = useContext(ProfileDismissal);
  const styles = useThemedStyles(createStyles);
  const userId = session.user_id;
  const insets = useSafeAreaInsets();
  const [identity, setIdentity] = useState<{ user_id: string; display_name: string; username?: string | null } | null>(null);
  const [identityError, setIdentityError] = useState('');
  const [cardThemeExpanded, setCardThemeExpanded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setIdentity(null); setIdentityError('');
    void request<{ user_id: string; display_name: string; username?: string | null }>('/auth/me', session, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setIdentity(value); })
      .catch(() => { if (!controller.signal.aborted) setIdentityError(ui("feedback.profile_load_help")); });
    return () => controller.abort();
  }, [userId, session.token]);
  return <KeyboardFrame><FormScrollView testID="profile-screen" accessibilityViewIsModal style={styles.page} keyboardShouldPersistTaps="handled" scrollEnabled={!cardThemeExpanded}
    contentContainerStyle={{ padding: 20, paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }}>
    <View style={styles.content}>
      <AppHeader title={ui("common.your_profile_title")} hideProfile inlineActions={<Pressable accessibilityRole="button" accessibilityLabel={ui("common.back_from_profile")} onPress={onBack} style={styles.back}><Ionicons name="arrow-back" size={22} color={styles.link.color} /></Pressable>} />
      <View testID="profile-identity" style={{ gap: 6, paddingVertical: 12 }}>
        <Text accessibilityRole="header" style={styles.title}>{identity?.display_name || identity?.username || (identityError ? ui("common.account_label") : ui("common.loading_profile"))}</Text>
        {!!identity?.username && <Text style={styles.description}>@{identity.username}</Text>}
        <Text selectable accessibilityLabel={ui("common.profile_id", {id: userId})} style={styles.description}>{ui("common.profile_id", {id: userId})}</Text>
        {!!identityError && <Text accessibilityRole="alert" style={styles.description}>{identityError}</Text>}
      </View>
      <View testID="profile-preferences" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={styles.description}>{ui("common.theme")}</Text><ThemeAction /></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={styles.description}>{ui("common.language_label")}</Text><LanguageToggle /></View>
      </View>
      <PushSettings />
      <DisplayNameField session={session} onSaved={display_name => setIdentity(current => current ? { ...current, display_name } : { user_id: userId, display_name })} />
      <CommunityRulesEntry session={session} /><ModerationEntry session={session} /><RecoveryEmailSettings session={session} /><BlockedPlayers session={session} />
      <><PolicyLinks /><DeleteAccountLink /></>
      <FriendsPanel session={session} friendLimit={6} />
      {onSignOut && <Pressable accessibilityRole="button" onPress={() => afterDismiss(onSignOut)} style={styles.signOut}><Text style={styles.signOutText}>{ui("common.sign_out_label")}</Text></Pressable>}
      <CreateCardThemeSelector device overlay onExpandedChange={setCardThemeExpanded} />
    </View>
  </FormScrollView></KeyboardFrame>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 16 },
  title: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 36, color: colors.text },
  back: { ...gameControlFinish(colors), minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  link: { fontFamily: fonts.medium, color: colors.accent, fontSize: 14 },
  signOut: { ...gameControlFinish(colors), minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium, alignItems: 'center', justifyContent: 'center' }, signOutText: { fontFamily: fonts.medium, color: colors.textMuted, fontSize: 13 },
  description: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 22 },
});
