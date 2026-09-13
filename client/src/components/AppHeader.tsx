import { createContext, useContext, useState, type ReactNode } from 'react';
import { Modal, Text, View, useWindowDimensions } from 'react-native';
import { BrandIcon } from './BrandArt';
import { HeaderAction } from './HeaderAction';
import { ThemeToggle } from './ThemeToggle';
import { fonts, useTheme } from '../theme';

export const HeaderProfileContext = createContext<((close: () => void) => ReactNode) | null>(null);

export function AppHeader({ title, actions, hideProfile = false }: { title?: string; actions?: ReactNode; hideProfile?: boolean }) {
  const { colors } = useTheme();
  const compact = useWindowDimensions().width < 900;
  const renderProfile = useContext(HeaderProfileContext);
  const [profileOpen, setProfileOpen] = useState(false);
  return <View style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <BrandIcon size={48} />
        {!!title && <Text accessibilityRole="header" style={{ flexShrink: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 18 }}>{title}</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ThemeToggle />
        {!hideProfile && renderProfile && <HeaderAction icon="profile" label="Profile" compact={compact} onPress={() => setProfileOpen(true)} />}
      </View>
    </View>
    {!!actions && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>{actions}</View>}
    {!hideProfile && renderProfile && profileOpen && <Modal visible animationType="slide" onRequestClose={() => setProfileOpen(false)}>
      {renderProfile(() => setProfileOpen(false))}
    </Modal>}
  </View>;
}
