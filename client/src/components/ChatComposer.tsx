import { FormInput } from './FormInput';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, useTheme } from '../theme';

export function ChatComposer({ value, onChange, onSend, disabled, placeholder, label, sendLabel = 'Send chat message', maxLength = 500, editable = true }: {
  value: string; onChange: (value: string) => void; onSend: () => void;
  disabled: boolean; placeholder: string; label: string; sendLabel?: string; maxLength?: number; editable?: boolean;
}) {
  const { colors: c } = useTheme();
  const input = useRef<TextInput>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (restoreFocus.current && !disabled) {
      restoreFocus.current = false;
      input.current?.focus();
    }
  }, [disabled, value]);
  const [height, setHeight] = useState(44);
  const length = Array.from(value).length;
  const unavailable = disabled || !value.trim() || length > maxLength;
  return <View style={{ gap: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 4, borderRadius: 24, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.borderSubtle }}>
      <FormInput ref={input} accessibilityLabel={label} placeholder={placeholder} placeholderTextColor={c.textMuted}
        multiline editable={editable} value={value} onChangeText={text => onChange(Array.from(text).slice(0, maxLength).join(''))}
        onContentSizeChange={event => setHeight(Math.max(44, Math.min(104, event.nativeEvent.contentSize.height)))}
        style={{ flex: 1, minWidth: 0, height: value ? height : 44, maxHeight: 104, paddingHorizontal: 12, paddingVertical: 12, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text }} />
      <Pressable accessibilityRole="button" accessibilityLabel={sendLabel} accessibilityState={{ disabled: unavailable }} disabled={unavailable}
        onPress={() => { restoreFocus.current = true; input.current?.focus(); onSend(); }}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: unavailable ? c.surfaceRaised : c.primary }}>
        <Ionicons name="arrow-up" size={22} color={unavailable ? c.textMuted : c.onPrimary} />
      </Pressable>
    </View>
    {length >= maxLength - Math.min(50, Math.ceil(maxLength / 10)) && <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 11, textAlign: 'right' }}>{length}/{maxLength}</Text>}
  </View>;
}
