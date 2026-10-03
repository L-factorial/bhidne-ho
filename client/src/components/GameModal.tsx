import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, Modal, type ModalProps, Platform, StyleSheet, View } from 'react-native';
import { GameModalLayers } from './GameModalLayers';

type GameModalContext = { layers: GameModalLayers<ReactNode>; active: boolean };
type GameModalProps = Omit<ModalProps, 'onShow' | 'onRequestClose'> & {
  onShow?: () => void; onRequestClose?: () => void;
};
const Context = createContext<GameModalContext | null>(null);

/** One native presentation owns the whole game. Retain its contents through
 * iOS dismissal, rather than swapping in the creation form while UIKit closes. */
export function GameModalRoot({ children, onDismiss, onRequestClose, visible = true, ...props }: ModalProps) {
  const [layers] = useState(() => new GameModalLayers<ReactNode>());
  const retained = useRef<ReactNode>(null);
  const currentlyVisible = useRef(visible);
  currentlyVisible.current = visible;
  if (visible) retained.current = children;
  const context = useMemo(() => ({ layers, active: visible }), [layers, visible]);
  return <Modal {...props} visible={visible} onRequestClose={event => {
    // Native Modal owns hardware Back; BackHandler is suppressed while open.
    if (!layers.requestCloseTop()) onRequestClose?.(event);
  }} onDismiss={() => {
    if (currentlyVisible.current) return; // Ignore dismissal from a replaced presentation.
    retained.current = null; layers.clear(); onDismiss?.();
  }}><Context.Provider value={context}>
    {Platform.OS === 'ios' && !visible ? retained.current : children}
  </Context.Provider></Modal>;
}

/** Place inside the game theme and TableSocialProvider so hosted children keep
 * the same game/social context as the controls which opened them. */
export function GameModalContent({ children }: { children: ReactNode }) {
  const context = useContext(Context);
  if (Platform.OS === 'web' || !context) return <>{children}</>;
  return <NativeGameModalContent context={context}>{children}</NativeGameModalContent>;
}

function NativeGameModalContent({ children, context }: { children: ReactNode; context: GameModalContext }) {
  const layers = useSyncExternalStore(context.layers.subscribe, context.layers.getSnapshot, context.layers.getSnapshot);
  const shown = context.active ? layers : [];
  return <View style={{ flex: 1, minHeight: 0 }}>
    <View style={{ flex: 1, minHeight: 0 }} pointerEvents={shown.length || !context.active ? 'none' : 'auto'}
      accessibilityElementsHidden={!!shown.length} importantForAccessibility={shown.length ? 'no-hide-descendants' : 'auto'}>
      {children}
    </View>
    {shown.map((layer, index) => <View key={layer.id.description} style={[StyleSheet.absoluteFill, { zIndex: index + 1 }]}
      pointerEvents={index === shown.length - 1 ? 'auto' : 'none'} accessibilityViewIsModal={index === shown.length - 1}
      onAccessibilityEscape={() => { context.layers.requestCloseTop(); }}
      accessibilityElementsHidden={index !== shown.length - 1} importantForAccessibility={index === shown.length - 1 ? 'auto' : 'no-hide-descendants'}>
      {layer.content}
    </View>)}
  </View>;
}

/** Native game overlays are views in the game's presentation, so ending a
 * table cannot strand a nested native modal over the room. Other screens and
 * web keep their existing Modal behavior. */
export function GameModal(props: GameModalProps) {
  const context = useContext(Context);
  if (Platform.OS === 'web' || !context) return <Modal {...props} />;
  return <NativeGameModal context={context} {...props} />;
}

let nextLayer = 0;
function NativeGameModal({ context, children, visible = true, transparent, onRequestClose, onShow, onDismiss }: GameModalProps & { context: GameModalContext }) {
  const [id] = useState(() => Symbol(`game-modal-${++nextLayer}`));
  const callbacks = useRef({ onRequestClose, onShow, onDismiss });
  callbacks.current = { onRequestClose, onShow, onDismiss };
  const shown = context.active && visible;
  // The store updates only its outlet; updates must not rerender this owner.
  useLayoutEffect(() => {
    if (shown) context.layers.show(id, <View style={[StyleSheet.absoluteFill, !transparent && { backgroundColor: 'white' }]}>{children}</View>, () => callbacks.current.onRequestClose?.());
    else context.layers.hide(id);
  }, [context.layers, id, shown, children, transparent]);
  useLayoutEffect(() => () => { context.layers.hide(id); }, [context.layers, id]);
  useEffect(() => {
    if (!shown) return;
    callbacks.current.onShow?.();
    return () => { callbacks.current.onDismiss?.(); };
  }, [context.layers, id, shown]);
  useEffect(() => {
    if (!context.active && visible) { Keyboard.dismiss(); callbacks.current.onRequestClose?.(); }
  }, [context.active, visible]);
  return null;
}
