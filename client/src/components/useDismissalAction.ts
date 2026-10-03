import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Close the presentation before an action can remove its owner. iOS supplies
 * onDismiss; other platforms finish after the hidden render is committed. */
export function useDismissalAction(visible: boolean, close: () => void) {
  const current = useRef({ visible, close });
  current.current = { visible, close };
  const pending = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => { pending.current = null; }, []);
  const mounted = useRef(true);
  const onDismiss = useCallback(() => {
    if (!mounted.current || current.current.visible) return;
    const action = pending.current;
    pending.current = null;
    action?.();
  }, []);
  const afterDismiss = useCallback((action: () => void) => {
    if (!mounted.current || pending.current) return;
    if (!current.current.visible) { action(); return; }
    pending.current = action;
    Keyboard.dismiss();
    current.current.close();
  }, []);
  useEffect(() => {
    if (visible) pending.current = null; // A reopened presentation supersedes its old navigation.
    if (!visible && Platform.OS !== 'ios') onDismiss();
  }, [visible, onDismiss]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current = null; };
  }, []);
  return { afterDismiss, onDismiss, cancel };
}
