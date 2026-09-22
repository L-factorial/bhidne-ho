import { BrandIcon } from './BrandArt';
import { KeyboardFrame } from './KeyboardFrame';
import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShareLink } from './ShareLink';
import { fonts, radii, typography, useTheme } from '../theme';
import { LanguageToggle } from './LanguageToggle';
import { useTranslation } from 'react-i18next';

export function GameTableHeader({ title, tableName, path, game, roomId, matchId, onBack, endControl, children, mobileTestIds = false, compact = false, drawerMetadata }: {
  tableName?: string; title: string; path?: string; game: string; roomId?: string; matchId?: string; onBack: () => void; endControl?: ReactNode;
  children?: ReactNode | ((closeMenu: () => void) => ReactNode);
  mobileTestIds?: boolean; compact?: boolean; drawerMetadata?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const mobile = useWindowDimensions().width < 900;
  const small = mobile || compact;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !drawerMetadata || Platform.OS !== 'web') return;
    // A child sheet captures at window first; otherwise consume Escape before the game modal.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    };
    document.addEventListener('keyup', escape, true);
    return () => document.removeEventListener('keyup', escape, true);
  }, [open, !!drawerMetadata]);
  return <>
    <View testID={`${game}-${mobile && mobileTestIds ? 'mobile-' : ''}header`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.borderSubtle }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.backToLobby')} onPress={onBack}
        style={{ minWidth: 44, minHeight: 44, paddingHorizontal: small ? 8 : 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surfaceRaised }}>
        <Text style={{ color: colors.text, fontFamily: fonts.body }}>{small ? '←' : t('common.backToLobby')}</Text>
      </Pressable>
      <BrandIcon size={28} />
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} accessibilityRole="header" style={{ fontFamily: fonts.medium, fontSize: small ? 17 : 20, color: colors.text }}>{tableName || title}</Text>
        {!!tableName && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: typography.caption, color: colors.textMuted }}>{title}</Text>}
        {!tableName && !!path && !compact && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 11, color: colors.textMuted }}>{path}</Text>}
      </View>
      {!!roomId && !compact && <ShareLink roomId={roomId} matchId={matchId} compact={mobile} />}
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.tableMenu')} accessibilityState={{ expanded: open }} onPress={() => setOpen(v => !v)}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderRadius: radii.medium }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: 5 }}>
          {[0, 1, 2].map(line => <View key={line} style={{ width: 22, height: 2, borderRadius: 1, backgroundColor: colors.text }} />)}
        </View>
      </Pressable>
    </View>
    {!!drawerMetadata && <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <KeyboardFrame style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', paddingTop: Math.max(12, insets.top), paddingBottom: Math.max(12, insets.bottom), paddingRight: Math.max(8, insets.right) }}>
        <Pressable testID={`${game}-menu-backdrop`} accessibilityRole="button" accessibilityLabel="Close table menu backdrop"
          onPress={() => setOpen(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay, opacity: 0.6 }} />
        <View testID={`${game}-menu-drawer`} accessibilityViewIsModal style={{ width: '86%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.borderSubtle, boxShadow: `0px 4px 12px ${colors.shadow}` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primarySoft, borderRadius: radii.medium }}>
            <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: fonts.medium, fontSize: typography.sectionTitle, paddingLeft: 10, flexShrink: 1 }}>{tableName || title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close table menu" onPress={() => setOpen(false)}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.textMuted, fontSize: 24 }}>×</Text></Pressable>
          </View>
          {drawerMetadata}
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 8, marginHorizontal: -8, paddingBottom: 8 }}>
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </ScrollView>
        </View>
      </KeyboardFrame>
    </Modal>}
    {open && !drawerMetadata && <ScrollView keyboardShouldPersistTaps="handled" testID={`${game}-${mobile && mobileTestIds ? 'mobile-' : ''}menu`} style={{ maxHeight: '40%', flexGrow: 0 }} contentContainerStyle={{ padding: 8, gap: 8 }} nestedScrollEnabled>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <LanguageToggle />
      </View>
      {compact && !!path && <Text style={{ color: colors.textMuted }}>{path}</Text>}
      {compact && !!roomId && <ShareLink roomId={roomId} matchId={matchId} />}
      {typeof children === 'function' ? children(() => setOpen(false)) : children}
      <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 4 }}>{endControl}</View>
    </ScrollView>}
  </>;
}
