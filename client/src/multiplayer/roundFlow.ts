export const ROUND_STEPS = ['Shuffle', 'Cut', 'Deal', 'Bid', 'Play', 'Scores'];
type FlowState = {
  your_player_id?: number | null;
  players?: { player_id: number; display_name?: string }[];
  game?: { phase: string; turn: { player_id: number | null }; current_trick?: { plays: { card: string }[] } | null };
  private?: { can_accept_hand: boolean } | null;
};

export function roundGuidance(snapshot: FlowState) {
  const phase = snapshot.game?.phase;
  const actor = snapshot.game?.turn.player_id;
  const mine = !!actor && actor === snapshot.your_player_id;
  const name = snapshot.players?.find(p => p.player_id === actor)?.display_name || `Player ${actor}`;
  const task = (step: number, action: string, instruction: string) => ({ step, title: mine ? `Your turn: ${action}` : `${name}: ${action}`, instruction, mine });
  switch (phase) {
    case 'AWAITING_SHUFFLE': return task(0, 'shuffle the deck', 'The dealer shuffles to begin this deal.');
    case 'SHUFFLING': return { step: 0, title: 'Shuffling', instruction: 'Preparing the deck.', mine: false };
    case 'AWAITING_CUT': return task(1, 'cut the deck', 'Cut in half or skip the cut.');
    case 'AWAITING_DISTRIBUTION': return task(2, 'deal the cards', 'The dealer distributes one card at a time to each player.');
    case 'HAND_REVIEW': return { step: 2, title: snapshot.private?.can_accept_hand ? 'Review your hand' : 'Waiting for hand review', instruction: snapshot.private?.can_accept_hand ? 'Accept your hand, or request a redeal if eligible.' : 'Bidding begins when everyone accepts.', mine: !!snapshot.private?.can_accept_hand };
    case 'BIDDING': return task(3, 'choose a bid', mine ? 'Choose how many tricks you will win, then confirm.' : 'Review your cards while the remaining players bid.');
    case 'PLAYING': {
      const lead = snapshot.game?.current_trick?.plays[0]?.card.slice(-1);
      const suit = ({ S: 'spades', C: 'clubs', H: 'hearts', D: 'diamonds' } as Record<string, string>)[lead || ''];
      return task(4, 'play a card', mine ? (suit ? `Follow ${suit} if you can. Select a legal card, then confirm Play.` : 'You lead this trick. Select a card, then confirm Play.') : 'Watch the table. Your legal cards light up on your turn.');
    }
    case 'DEAL_COMPLETE': return { step: 5, title: 'Deal complete', instruction: 'Review the scores before the next deal.', mine: false };
    case 'MATCH_COMPLETE': return { step: 5, title: 'Match complete', instruction: 'Final scores after five deals.', mine: false };
    default: return { step: 0, title: 'Preparing the deal', instruction: 'Waiting for the table.', mine: false };
  }
}
