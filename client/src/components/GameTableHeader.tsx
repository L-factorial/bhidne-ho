import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { BrandIcon } from './BrandArt';
import { ShareLink } from './ShareLink';
import { ThemeToggle } from './ThemeToggle';
import { fonts, useTheme } from '../theme';
import { LanguageToggle } from './LanguageToggle';
import { useTranslation } from 'react-i18next';

export function GameTableHeader({ title, path, game, roomId, matchId, onBack, endControl, children, mobileTestIds = false, compact = false }: {
  title: string; path?: string; game: string; roomId?: string; matchId?: string; onBack: () => void; endControl?: ReactNode;
  children?: ReactNode | ((closeMenu: () => void) => ReactNode);
  mobileTestIds?: boolean; compact?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const mobile = useWindowDimensions().width < 900;
  const small = mobile || compact;
  const [open, setOpen] = useState(false);
  return <>
    <View testID={`${game}-${mobile && mobileTestIds ? 'mobile-' : ''}header`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderBottomWidth: 1, borderColor: colors.border }}>
      <BrandIcon size={small ? 30 : 48} />
      <View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ fontFamily: fonts.medium, fontSize: small ? 17 : 20, color: colors.text }}>{title}</Text>
        {!!path && !compact && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 11, color: colors.textMuted }}>{path}</Text>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.backToLobby')} onPress={onBack}
        style={{ minWidth: 44, minHeight: 44, paddingHorizontal: small ? 8 : 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surfaceRaised }}>
        <Text style={{ color: colors.text, fontFamily: fonts.body }}>{small ? '←' : t('common.backToLobby')}</Text>
      </Pressable>
      {!!roomId && !compact && <ShareLink roomId={roomId} matchId={matchId} compact={mobile} />}
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.tableMenu')} accessibilityState={{ expanded: open }} onPress={() => setOpen(v => !v)}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: 5 }}>
          {[0, 1, 2].map(line => <View key={line} style={{ width: 22, height: 2, borderRadius: 1, backgroundColor: colors.text }} />)}
        </View>
      </Pressable>
    </View>
    {open && <ScrollView testID={`${game}-${mobile && mobileTestIds ? 'mobile-' : ''}menu`} style={{ maxHeight: '40%', flexGrow: 0 }} contentContainerStyle={{ padding: 8, gap: 8 }} nestedScrollEnabled>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <LanguageToggle /><ThemeToggle />
      </View>
      {compact && !!path && <Text style={{ color: colors.textMuted }}>{path}</Text>}
      {compact && !!roomId && <ShareLink roomId={roomId} matchId={matchId} />}
      {typeof children === 'function' ? children(() => setOpen(false)) : children}
      <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 4 }}>{endControl}</View>
    </ScrollView>}
  </>;
}
