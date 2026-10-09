import { useEffect, useState } from 'react';
import { initialHandDrawer, updateHandDrawer, type HandDrawerInput } from './handDrawer';

export function useCallBreakHand(input: HandDrawerInput, onAction: (command: string, payload?: object) => void) {
  const [state, setState] = useState(initialHandDrawer);
  const { deal, turn, revision, hand, busy, error, keepCollapsed } = input;
  useEffect(() => { setState(current => updateHandDrawer(current, { deal, turn, revision, hand, busy, error, keepCollapsed })); },
    [deal, turn, revision, hand, busy, error, keepCollapsed]);
  return {
    open: !keepCollapsed && state.open,
    collapse: () => setState(current => ({ ...current, open: false })),
    toggle: () => setState(current => ({ ...current, open: !current.open })),
    act: (command: string, payload?: object) => {
      if (busy) return;
      if (command === 'PLAY_CARD' && payload && 'card' in payload && typeof payload.card === 'string') {
        const card = payload.card;
        setState(current => ({ ...current, pending: { card, revision } }));
      }
      onAction(command, payload);
    },
  };
}
