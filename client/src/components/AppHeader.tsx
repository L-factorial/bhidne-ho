import {AppText as Text} from './AppText';
import { ui } from '../i18n/copy.ts';
import { fonts, typography, useTheme } from '../theme';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {Pressable, View, useWindowDimensions} from 'react-native';
import { ProfileModal } from './ProfileModal';
import { BrandIcon, headerLogoSize } from './BrandArt';
import { HeaderAction } from './HeaderAction';
import { useTranslation } from 'react-i18next';

export const HeaderProfileContext = createContext<((close: () => void) => ReactNode) | null>(null);

export function AppHeader({ title, actions, inlineActions, hideProfile = false, lobby = false, onOpenProfile, onBack, logoSize = headerLogoSize }: {
  onBack?: () => void; title?: string; actions?: ReactNode; inlineActions?: ReactNode; hideProfile?: boolean; lobby?: boolean; onOpenProfile?: () => void; logoSize?: number;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const compact = useWindowDimensions().width < 900;
  const renderProfile = useContext(HeaderProfileContext);
  const [profileOpen, setProfileOpen] = useState(false);
  return <View style={{ paddingHorizontal: compact ? 4 : 12, paddingVertical: compact ? 6 : 10, gap: 8,
    borderBottomWidth: 1, borderColor: colors.borderSubtle, backgroundColor: lobby ? colors.background : colors.header }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: compact ? 8 : 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 6 : 10, flex: 1, minWidth: 0 }}>
        {onBack && <Pressable accessibilityRole="button" accessibilityLabel={ui('common.back')} onPress={onBack} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="arrow-back" size={22} color={colors.textMuted} /></Pressable>}
        <BrandIcon size={logoSize} />
        {!!title && <Text accessibilityRole="header" style={{ flexShrink: 1, color: colors.text, fontFamily: fonts.editorial, fontSize: typography.pageTitle }}>{title}</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: compact ? 6 : 10 }}>
        {inlineActions}
        {!hideProfile && renderProfile && <HeaderAction icon="profile" label={t('common.profile')} compact={compact} onPress={onOpenProfile || (() => setProfileOpen(true))} />}
      </View>
    </View>
    {!!actions && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>{actions}</View>}
    {!hideProfile && renderProfile && <ProfileModal visible={profileOpen} onClose={() => setProfileOpen(false)}>
      {renderProfile(() => setProfileOpen(false))}
    </ProfileModal>}
  </View>;
}
