import {AppText as Text} from './AppText';
import { GameModal as Modal } from './GameModal';
import { useEffect, useRef, useState } from 'react';
import {Platform, Pressable, View, useWindowDimensions} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { gameControlFinish, gamePanelFinish, fonts, useTheme } from '../theme';
import { useLanguage } from '../i18n/LanguageProvider';

export function LanguageToggle() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const button = useRef<View>(null), selected = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = () => { setAnchor(null); button.current?.focus(); };
  useEffect(() => {
    if (!anchor || Platform.OS !== 'web') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    window.addEventListener('keyup', escape, true);
    return () => window.removeEventListener('keyup', escape, true);
  }, [!!anchor]);
  const menuWidth = 192;
  return <>
    <Pressable ref={button} accessibilityRole="button" accessibilityLabel={t('language.choose')}
      accessibilityState={{ expanded: !!anchor }} aria-expanded={!!anchor}
      onPress={() => button.current?.measureInWindow((x, y, w, h) => setAnchor({ x: x + w, y: y + h }))}
      style={({ pressed }) => ({ ...gameControlFinish(colors, pressed), width: 44, height: 44, flexShrink: 0,
        borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceSelected : colors.surface })}>
      <Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: 17 }}>{'अ A'}</Text>
    </Pressable>
    <Modal transparent visible={!!anchor} animationType="none" onRequestClose={close} onShow={() => selected.current?.focus()}>
      <View style={{ flex: 1 }} onAccessibilityEscape={close}
        {...(Platform.OS === 'web' ? { onKeyDown: (event: { key: string; preventDefault(): void; stopPropagation(): void }) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        } } : {})}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('language.close')} onPress={close}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <View testID="language-menu" accessibilityViewIsModal style={{ ...gamePanelFinish(colors), position: 'absolute',
          top: Math.max(insets.top + 8, Math.min((anchor?.y ?? 0) + 8, height - insets.bottom - 120)),
          left: Math.max(insets.left + 8, Math.min((anchor?.x ?? width) - menuWidth, width - insets.right - menuWidth - 8)),
          width: menuWidth, padding: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          {(['en', 'ne'] as const).map(value => <Pressable key={value} ref={language === value ? selected : undefined}
            accessibilityRole="radio" accessibilityLabel={value === 'en' ? 'English' : 'नेपाली'} accessibilityState={{ checked: language === value }} aria-checked={language === value}
            onPress={() => { setLanguage(value); close(); }}
            style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 12, borderRadius: 8,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: pressed || language === value ? colors.surfaceSelected : colors.surface })}>
            <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 16 }}>{value === 'en' ? 'English' : 'नेपाली'}</Text>
            {language === value && <Ionicons name="checkmark" size={20} color={colors.accent} />}
          </Pressable>)}
        </View>
      </View>
    </Modal>
  </>;
}
