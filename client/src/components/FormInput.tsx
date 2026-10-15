import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {Ionicons} from '@expo/vector-icons';
import {ui} from '../i18n/copy';
import { radii, fonts, useTheme } from '../theme';
import { Keyboard, Platform, ScrollView, StyleSheet, type ScrollViewProps, Pressable, View, TextInput, type TextInputProps } from 'react-native';

export const FormFocusContext = createContext<(input: TextInput | null) => void>(() => {});

/** Keep the focused field inside the scrolling body, including above a fixed footer. */
export function FormScrollView({ children, onLayout, onScroll, onContentSizeChange, ...props }: ScrollViewProps) {
  const scroll = useRef<ScrollView>(null);
  const focused = useRef<TextInput | null>(null);
  const offset = useRef(0);
  const frame = useRef(0);
  const reveal = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const input = focused.current;
      if (!input || !scroll.current) return;
      if (Platform.OS === 'web') {
        (input as unknown as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
      scroll.current.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
        input.measureInWindow((_inputX, inputTop, _inputWidth, inputHeight) => {
          if (focused.current !== input || !height) return;
          const delta = inputTop + inputHeight > top + height - 12 ? inputTop + inputHeight - top - height + 12
            : inputTop < top + 12 ? inputTop - top - 12 : 0;
          if (delta) scroll.current?.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
        });
      });
    });
  }, []);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', reveal);
    const changed = Keyboard.addListener('keyboardDidChangeFrame', reveal);
    return () => { subscription.remove(); changed.remove(); cancelAnimationFrame(frame.current); };
  }, [reveal]);
  return <FormFocusContext.Provider value={input => { focused.current = input; if (input) reveal(); }}>
    <ScrollView {...props} ref={scroll} keyboardShouldPersistTaps="handled" scrollEventThrottle={16}
      onLayout={event => { onLayout?.(event); reveal(); }}
      onContentSizeChange={(width, height) => { onContentSizeChange?.(width, height); reveal(); }}
      onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }}>{children}</ScrollView>
  </FormFocusContext.Provider>;
}

export const FormInput = forwardRef<TextInput, TextInputProps>(function FormInput({ onFocus, onBlur, style, ...props }, ref) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput | null>(null);
  const reveal = useContext(FormFocusContext);
  const next = props.returnKeyType === "next" && !!props.onSubmitEditing;
  const field = <TextInput {...props} ref={node => { input.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
    placeholderTextColor={props.placeholderTextColor || colors.textMuted}
    style={[{fontFamily:fonts.body,fontSize:16,lineHeight:24}, style, { ...(next ? {paddingRight:48} : {}), fontSize: Math.max(16, StyleSheet.flatten(style)?.fontSize ?? 16), lineHeight: Math.max(24, StyleSheet.flatten(style)?.lineHeight ?? 24), boxShadow: `inset 0px 2px 4px ${colors.shadow}`, borderRadius: radii.medium, borderColor:focused ? colors.accent : colors.border, color:colors.text, backgroundColor:colors.surface, outlineColor:colors.accent }, Platform.OS === 'web' && {fontSize:16,outlineStyle:'solid',outlineWidth:focused ? 2 : 0,outlineOffset:2}]}
    onFocus={event => {setFocused(true);reveal(input.current);onFocus?.(event);}} onBlur={event=>{setFocused(false);reveal(null);onBlur?.(event);}} />;
  if (!next) return field;
  return <View style={[{position:"relative"}, {alignSelf: "stretch"}, StyleSheet.flatten(style)?.flex !== undefined && {flex:StyleSheet.flatten(style)?.flex}]}>{field}
    {next && <Pressable accessibilityRole="button" accessibilityLabel={ui('common.next_field')} disabled={props.editable === false} onPress={() => props.onSubmitEditing?.({nativeEvent:{text:props.value ?? ''}} as Parameters<NonNullable<TextInputProps['onSubmitEditing']>>[0])} style={{position:'absolute',right:4,top:4,bottom:4,width:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="arrow-forward" size={22} color={colors.accent}/></Pressable>}
  </View>;
});
