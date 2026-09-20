import { FormInput } from './FormInput';
import { useId } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, Text, type TextInputProps, View } from 'react-native';
import { fonts, useTheme } from '../theme';

/** iOS number pads have no return key; always provide an explicit dismissal action. */
export function NumericInput(props: TextInputProps) {
  const id = useId();
  const { colors } = useTheme();
  return <><FormInput {...props} keyboardType="number-pad" returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
    inputAccessoryViewID={Platform.OS === 'ios' ? id : undefined} />
    {Platform.OS === 'ios' && <InputAccessoryView nativeID={id}><View style={{ alignItems: 'flex-end', backgroundColor: colors.surface }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Done editing number" onPress={Keyboard.dismiss} style={{ minHeight: 44, minWidth: 64, paddingHorizontal: 16, justifyContent: 'center' }}>
        <Text style={{ color: colors.accent, fontFamily: fonts.medium }}>Done</Text>
      </Pressable></View></InputAccessoryView>}
  </>;
}
