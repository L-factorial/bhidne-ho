import { TableThemePicker } from './TableThemePicker';
import { Ionicons } from '@expo/vector-icons';
import { RoomSheet } from './RoomSheet';
import { useTableTheme } from '../TableThemeProvider';
import { BrandIcon, headerLogoSize } from './BrandArt';
import { KeyboardFrame } from './KeyboardFrame';
import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TableShareSheet } from './ShareLink';
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
  const [themesOpen, setThemesOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const { theme } = useTableTheme();
  const openThemes = () => { setOpen(false); setThemesOpen(true); };
  const themeMenuEntry = <Pressable accessibilityRole="button" accessibilityLabel={`Table theme, ${theme.name}`} onPress={openThemes}
    style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, borderRadius: radii.medium, backgroundColor: pressed ? colors.surfaceRaised : 'transparent' })}>
    <Ionicons name="color-palette-outline" size={20} color={colors.textMuted} />
    <View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.text, fontFamily: fonts.medium }}>Table theme</Text>
      <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{theme.name}</Text></View>
    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
  </Pressable>;
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
      <BrandIcon size={mobile ? headerLogoSize.compact : headerLogoSize.regular} />
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} accessibilityRole="header" style={{ fontFamily: fonts.medium, fontSize: small ? 17 : 20, color: colors.text }}>{tableName || title}</Text>
        {!!tableName && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: typography.caption, color: colors.textMuted }}>{title}</Text>}
        {!tableName && !!path && !compact && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 11, color: colors.textMuted }}>{path}</Text>}
      </View>
      <Pressable testID={`${game}-theme-button`} accessibilityRole="button" accessibilityLabel="Choose table theme" accessibilityHint={`Current theme: ${theme.name}`} accessibilityState={{ expanded: themesOpen }} onPress={openThemes}
        style={({ pressed }) => ({ flexDirection: 'row', flexShrink: 0, gap: 6, minWidth: 44, minHeight: 44, paddingHorizontal: mobile ? 8 : 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.surfaceRaised : 'transparent', borderRadius: radii.medium })}>
        <Ionicons name="color-palette-outline" size={22} color={colors.text} />
        {!mobile && <Text style={{ color: colors.text, fontFamily: fonts.medium }}>Theme</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.tableMenu')} accessibilityState={{ expanded: open }} onPress={() => setOpen(v => !v)}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderRadius: radii.medium }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: 5 }}>
          {[0, 1, 2].map(line => <View key={line} style={{ width: 22, height: 2, borderRadius: 1, backgroundColor: colors.text }} />)}
        </View>
      </Pressable>
    </View>
    {/* Web menu dismissal must finish before a newly opened chat takes focus. */}
    {!!drawerMetadata && <Modal transparent visible={open} animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={() => setOpen(false)}>
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
            {themeMenuEntry}
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
      {!!roomId && !!matchId && <Pressable accessibilityRole="button" accessibilityLabel="Share table" onPress={() => { setOpen(false); setSharing(true); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.text, fontFamily: fonts.medium }}>Share table</Text></Pressable>}
      {themeMenuEntry}
      {typeof children === 'function' ? children(() => setOpen(false)) : children}
      <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 4 }}>{endControl}</View>
    </ScrollView>}
    {!!roomId && !!matchId && !drawerMetadata && <TableShareSheet roomId={roomId} matchId={matchId} visible={sharing} onClose={() => setSharing(false)} />}
    <RoomSheet visible={themesOpen} title="Table theme" closeLabel="Close table themes" testID="table-theme-sheet" presentation="dialog" onClose={() => setThemesOpen(false)}>
      <TableThemePicker showTitle={false} />
    </RoomSheet>
  </>;
}
