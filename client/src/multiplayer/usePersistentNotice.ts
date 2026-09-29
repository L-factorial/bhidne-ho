import { useEffect, useState } from 'react';

// Transient background recovery is quiet. Action failures use immediate feedback.
export function usePersistentNotice(active: boolean, delay = 1500): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return active && visible;
}
