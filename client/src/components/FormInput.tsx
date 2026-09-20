import { createContext, forwardRef, useCallback, useContext, useEffect, useRef } from 'react';
import { Keyboard, Platform, ScrollView, type ScrollViewProps, TextInput, type TextInputProps } from 'react-native';

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
    return () => { subscription.remove(); cancelAnimationFrame(frame.current); };
  }, [reveal]);
  return <FormFocusContext.Provider value={input => { focused.current = input; if (input) reveal(); }}>
    <ScrollView {...props} ref={scroll} keyboardShouldPersistTaps="handled" scrollEventThrottle={16}
      onLayout={event => { onLayout?.(event); reveal(); }}
      onContentSizeChange={(width, height) => { onContentSizeChange?.(width, height); reveal(); }}
      onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }}>{children}</ScrollView>
  </FormFocusContext.Provider>;
}

export const FormInput = forwardRef<TextInput, TextInputProps>(function FormInput({ onFocus, onBlur, style, ...props }, ref) {
  const input = useRef<TextInput | null>(null);
  const reveal = useContext(FormFocusContext);
  return <TextInput {...props} ref={node => { input.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
    style={[style, Platform.OS === 'web' && { fontSize: 16 }]}
    onFocus={event => { reveal(input.current); onFocus?.(event); }}
    onBlur={event => { reveal(null); onBlur?.(event); }} />;
});
