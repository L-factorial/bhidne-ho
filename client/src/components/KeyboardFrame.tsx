import { FormFocusContext } from './FormInput';
import { type ReactNode, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';

/** One owner per screen/modal. Android uses window resize; iOS uses keyboard padding.
 * Mobile browsers report the keyboard through the visual viewport, not window resize. */
export function KeyboardFrame({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !window.visualViewport) return;
    const visible = window.visualViewport;
    let frame = 0;
    const update = () => {
      if (Math.abs(visible.scale - 1) > 0.05) return; // Preserve pinch zoom.
      setViewport({ height: visible.height, top: visible.offsetTop });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.matches('input, textarea')) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };
    update();
    visible.addEventListener('resize', update);
    visible.addEventListener('scroll', update);
    return () => { cancelAnimationFrame(frame); visible.removeEventListener('resize', update); visible.removeEventListener('scroll', update); };
  }, []);
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    style={[{ flex: 1, minHeight: 0 }, style, viewport && { maxHeight: viewport.height, marginTop: viewport.top }]}><FormFocusContext.Provider value={() => {}}>{children}</FormFocusContext.Provider></KeyboardAvoidingView>;
}
