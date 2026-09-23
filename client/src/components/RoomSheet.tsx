import { gamePanelFinish, fonts, radii, space, typography, useTheme } from '../theme';
import { FormScrollView } from './FormInput';
import { KeyboardFrame } from './KeyboardFrame';
import { type ReactNode, useEffect } from 'react';
import { Keyboard, Modal, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function RoomSheet({ visible, title, onClose, children, scrollable = true, footer, testID = 'room-sheet', closeLabel = 'Close room panel', contentHandlesBottomInset = false, presentation = 'sheet', tableStyle = false, headerActions }: { headerActions?: ReactNode; tableStyle?: boolean; visible: boolean; title: string; onClose: () => void; children: ReactNode; scrollable?: boolean; footer?: ReactNode; testID?: string; closeLabel?: string; contentHandlesBottomInset?: boolean; presentation?: 'sheet' | 'dialog' }) {
  const { colors: c } = useTheme();
  const wide = useWindowDimensions().width >= 900;
  const insets = useSafeAreaInsets();
  const dialog = presentation === 'dialog';
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const previous = document.activeElement as HTMLElement | null;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); Keyboard.dismiss(); onClose(); } };
    globalThis.addEventListener('keyup', escape, true);
    return () => { globalThis.removeEventListener('keyup', escape, true); previous?.focus?.(); };
  }, [visible]);
  const close = () => { Keyboard.dismiss(); onClose(); };
  return <Modal transparent visible={visible} animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={close} onShow={() => {
    if (Platform.OS === 'web') {
      const closeButton = document.querySelector('[data-testid="room-sheet-close"]') as HTMLElement | null;
      // The entrance animation can finish after the user has already started typing.
      if (!closeButton?.parentElement?.parentElement?.contains(document.activeElement)) closeButton?.focus();
    }
  }}>
    <KeyboardFrame style={[{ flex: 1, backgroundColor: c.overlay, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0, paddingTop: Math.max(24, insets.top) }, dialog && { justifyContent: 'center', paddingHorizontal: space.xl, paddingTop: Math.max(16, insets.top), paddingBottom: Math.max(16, insets.bottom) }]}>
      <View testID={testID} accessibilityViewIsModal style={[{ ...gamePanelFinish(c), width: '100%', maxWidth: wide ? 640 : undefined, maxHeight: '90%', height: scrollable ? undefined : '90%', minHeight: 0, backgroundColor: c.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, borderBottomLeftRadius: wide ? 20 : 0, borderBottomRightRadius: wide ? 20 : 0, paddingBottom: footer || contentHandlesBottomInset ? 0 : Math.max(16, insets.bottom) }, dialog && { maxWidth: 480, maxHeight: '100%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: 'hidden' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.xl, paddingTop: 12, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, backgroundColor: c.tableHeader, borderBottomWidth: 1, borderColor: c.tableTrim }}>
          <Text accessibilityRole="header" style={{ flex: 1, fontFamily: fonts.medium, color: tableStyle ? c.onTableHeader : c.text, fontSize: typography.sectionTitle }}>{title}</Text>
          {headerActions}
          <Pressable testID="room-sheet-close" accessibilityRole="button" accessibilityLabel={closeLabel} onPress={close} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: tableStyle ? c.onTableHeader : c.text, fontSize: 24 }}>×</Text></Pressable>
        </View>
        {scrollable ? <FormScrollView style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12 }}>{children}</FormScrollView>
          : <View style={{ flex: 1, minHeight: 0 }}>{children}</View>}
        {footer}
      </View>
    </KeyboardFrame>
  </Modal>;
}
