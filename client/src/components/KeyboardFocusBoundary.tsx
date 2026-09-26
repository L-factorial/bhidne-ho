import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';

/** Browser-owned focus isolation: background RN Web modal callbacks cannot
 * focus their controls while the chat dialog is in the browser's top layer. */
export function KeyboardFocusBoundary({ enabled, visible, label, onClose, children }: {
  enabled: boolean; visible: boolean; label: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const supported = Platform.OS === 'web' && typeof HTMLDialogElement !== 'undefined'
    && typeof HTMLDialogElement.prototype.showModal === 'function';
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!enabled || !supported || !visible || !node) return;
    node.showModal();
    return () => { if (node.open) node.close(); };
  }, [enabled, supported, visible]);
  if (!enabled || !supported) return <>{children}</>;
  return <dialog ref={dialog} className="keyboard-focus-dialog" aria-label={label}
    // RoomSheet consumes Escape on keyup. Avoid closing on keydown too, which
    // would let that keyup reach the game modal after chat has unmounted.
    onKeyDownCapture={event => { if (event.key === 'Escape') event.preventDefault(); }}
    onCancel={event => { event.preventDefault(); onClose(); }}
    style={{ position: 'fixed', inset: 0, margin: 0, padding: 0, border: 0, width: '100%', height: '100%',
      maxWidth: 'none', maxHeight: 'none', background: 'transparent', display: visible ? 'flex' : 'none', flexDirection: 'column', outline: 'none' }}>
    <style>{'.keyboard-focus-dialog::backdrop { background: transparent; }'}</style>
    {children}
  </dialog>;
}
