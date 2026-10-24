// Dealer picks are sequential. Resolve a definitive state conflict by reading
// the current selection, never by choosing a replacement card or a later turn.
export function isDealerPickConflict(command: string | undefined, detail: string): boolean {
  return command === 'PICK_DEALER_CARD' && [
    'The turn changed. Your view has been refreshed; try again.',
    'Refresh game state before retrying.',
    'Dealer selection is not active.',
    'Wait for your turn to pick a dealer card.',
    'That card has already been picked.',
    'Request belongs to another deal attempt.',
    'The game changed. Your pending action was not retried.',
  ].includes(detail);
}
