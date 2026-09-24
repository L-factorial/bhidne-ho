import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { FormInput } from './FormInput';
import { useCallback, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, useTheme } from '../theme';

export function ChatComposer({ value, onChange, onSend, disabled, placeholder, label, sendLabel = ui("social.send_chat_message"), maxLength = 500, editable = true }: {
  value: string; onChange: (value: string) => void; onSend: () => void;
  disabled: boolean; placeholder: string; label: string; sendLabel?: string; maxLength?: number; editable?: boolean;
}) {
  const uiLanguage = useUiLanguage();
  const { colors: c } = useTheme();
  const input = useRef<TextInput>(null);
  const [height, setHeight] = useState(44);
  const onContentSizeChange = useCallback<NonNullable<TextInputProps['onContentSizeChange']>>(event => {
    const next = Math.max(44, Math.min(104, Math.ceil(event.nativeEvent.contentSize.height)));
    setHeight(current => current === next ? current : next);
  }, [uiLanguage]);
  const length = Array.from(value).length;
  const unavailable = disabled || !value.trim() || length > maxLength;
  return <View style={{ gap: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 4 }}>
      <FormInput ref={input} accessibilityLabel={label} placeholder={placeholder} placeholderTextColor={c.textMuted}
        multiline editable={editable} value={value} onChangeText={text => onChange(Array.from(text).slice(0, maxLength).join(''))}
        onContentSizeChange={onContentSizeChange}
        style={{ flex: 1, minWidth: 0, height: value ? height : 44, maxHeight: 104, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.surfaceRaised, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text }} />
      <Pressable accessibilityRole="button" accessibilityLabel={sendLabel} accessibilityState={{ disabled: unavailable }} disabled={unavailable}
        onPress={() => { input.current?.blur(); Keyboard.dismiss(); onSend(); }}
        style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: unavailable ? c.surfaceRaised : c.primary }}>
        <Ionicons name="arrow-up" size={22} color={unavailable ? c.textMuted : c.onPrimary} />
      </Pressable>
    </View>
    {length >= maxLength - Math.min(50, Math.ceil(maxLength / 10)) && <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 11, textAlign: 'right' }}>{length}/{maxLength}</Text>}
  </View>;
}
