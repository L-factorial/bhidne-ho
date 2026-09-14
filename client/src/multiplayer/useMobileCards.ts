import { useEffect, useRef, useState } from 'react';

// Keep local card reveal/selection actions separate from confirmed game commands.
export function useMobileCards({ mobile, busy, error, promptKey, onAction }: {
  mobile: boolean; busy: boolean; error: string; promptKey: string | null;
  onAction: (command: string, payload?: object) => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = useRef(false), sawBusy = useRef(false);
  useEffect(() => {
    if (!pending.current) return;
    if (busy) { sawBusy.current = true; return; }
    if (!sawBusy.current) return;
    pending.current = false; sawBusy.current = false;
    setOpen(!!error);
  }, [busy, error]);
  useEffect(() => { if (promptKey) setOpen(true); }, [promptKey]);
  function act(command: string, payload?: object) {
    // These commands complete the player's current decision. Drawing and meld
    // validation leave the hand open for the rest of a Marriage turn.
    if (mobile && !busy && ['PLAY_CARD', 'PLACE_BID', 'ACCEPT_HAND', 'CLAIM_REDEAL', 'DISCARD_CARD', 'FINISH'].includes(command)) pending.current = true;
    onAction(command, payload);
  }
  return { open, setOpen, act, toggle: () => setOpen(v => !v) };
}
