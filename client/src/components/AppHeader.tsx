import { createContext, useContext, useState, type ReactNode } from 'react';
import { Modal, Text, View, useWindowDimensions } from 'react-native';
import { BrandIcon } from './BrandArt';
import { HeaderAction } from './HeaderAction';
import { fonts, useTheme } from '../theme';
import { LanguageToggle } from './LanguageToggle';
import { useTranslation } from 'react-i18next';

export const HeaderProfileContext = createContext<((close: () => void) => ReactNode) | null>(null);

export function AppHeader({ title, actions, inlineActions, hideProfile = false, lobby = false, onOpenProfile }: {
  title?: string; actions?: ReactNode; inlineActions?: ReactNode; hideProfile?: boolean; lobby?: boolean; onOpenProfile?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const compact = useWindowDimensions().width < 900;
  const renderProfile = useContext(HeaderProfileContext);
  const [profileOpen, setProfileOpen] = useState(false);
  return <View style={{ paddingHorizontal: compact ? 4 : 12, paddingVertical: compact ? 6 : 10, gap: 8,
    borderBottomWidth: lobby ? 0 : 1, borderColor: colors.border, backgroundColor: lobby ? colors.background : colors.header }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <BrandIcon size={compact ? 38 : 44} />
        {!title && <Text style={{ color: colors.text, fontFamily: lobby ? fonts.editorial : fonts.medium, fontSize: lobby ? 28 : compact ? 16 : 18 }}>Bhidne Ho</Text>}
        {!!title && <Text accessibilityRole="header" style={{ flexShrink: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 18 }}>{title}</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {!renderProfile && !hideProfile && <><LanguageToggle /></>}
        {inlineActions}
        {!hideProfile && renderProfile && <HeaderAction icon="profile" label={t('common.profile')} compact={compact} onPress={onOpenProfile || (() => setProfileOpen(true))} />}
      </View>
    </View>
    {!!actions && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>{actions}</View>}
    {!hideProfile && renderProfile && profileOpen && <Modal visible animationType="slide" onRequestClose={() => setProfileOpen(false)}>
      {renderProfile(() => setProfileOpen(false))}
    </Modal>}
  </View>;
}
