// Presentation state only; turns and successful plays come from server snapshots.
export type HandDrawerState = { open: boolean; entered: string | null; deal: string; pending: { card: string; revision: number } | null };
export type HandDrawerInput = { deal: string; turn: string | null; revision: number; hand: string[]; busy: boolean; error: string };
export const initialHandDrawer: HandDrawerState = { open: false, entered: null, deal: '', pending: null };
export function updateHandDrawer(state: HandDrawerState, input: HandDrawerInput): HandDrawerState {
  let next = state.deal === input.deal ? state : { ...initialHandDrawer, deal: input.deal };
  if (next.pending) {
    if (input.revision > next.pending.revision && !input.hand.includes(next.pending.card)) {
      next = { ...next, open: false, pending: null };
    } else if (!input.busy && input.error) {
      next = { ...next, open: true, pending: null };
    }
  }
  if (input.turn && input.turn !== next.entered && !next.pending) {
    next = { ...next, open: true, entered: input.turn };
  }
  return next;
}
