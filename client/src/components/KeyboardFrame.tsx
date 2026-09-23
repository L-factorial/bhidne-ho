import { FormFocusContext } from './FormInput';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

/** One owner per screen/modal. Android uses window resize; iOS uses keyboard padding.
 * Mobile browsers report the keyboard through the visual viewport, not window resize. */
export function KeyboardFrame({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const root = useRef<View>(null);
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !window.visualViewport) return;
    const visible = window.visualViewport;
    let frame = 0;
    let revealInput = false;
    const update = () => {
      frame = 0;
      if (Math.abs(visible.scale - 1) > 0.05) { revealInput = false; return; }
      const height = visible.height, top = visible.offsetTop;
      setViewport(current => current && Math.abs(current.height - height) < 1 && Math.abs(current.top - top) < 1
        ? current : { height, top });
      if (revealInput) {
        const active = document.activeElement;
        const container = root.current as unknown as HTMLElement | null;
        // Only the frame owning the input may reveal it. Background modals must
        // never scroll the active sheet, and scrolling must not trigger itself.
        if (active instanceof HTMLElement && active.matches('input, textarea') && container?.contains(active)) {
          const bounds = active.getBoundingClientRect();
          if (bounds.top < top || bounds.bottom > top + height) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
      revealInput = false;
    };
    const schedule = (reveal: boolean) => {
      revealInput ||= reveal;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = () => schedule(true);
    const scroll = () => schedule(false);
    resize();
    visible.addEventListener('resize', resize);
    visible.addEventListener('scroll', scroll);
    return () => { cancelAnimationFrame(frame); visible.removeEventListener('resize', resize); visible.removeEventListener('scroll', scroll); };
  }, []);
  return <View ref={root} style={{ flex: 1, minHeight: 0 }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    style={[{ flex: 1, minHeight: 0 }, style, viewport && { maxHeight: viewport.height, marginTop: viewport.top }]}><FormFocusContext.Provider value={() => {}}>{children}</FormFocusContext.Provider></KeyboardAvoidingView></View>;
}
