import { ui, uiLabel } from '../i18n/copy.ts';
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
  const name = snapshot.players?.find(p => p.player_id === actor)?.display_name || ui("common.player_number", { "number": actor });
  const task = (step: number, action: string, instruction: string) => ({ step, title: mine ? ui("common.your_turn_colon", { "action": action }) : ui("common.label_yes_no", { "label": name, "value": action }), instruction, mine });
  switch (phase) {
    case 'AWAITING_SHUFFLE': return task(0, ui("callbreak.shuffle_the_deck"), ui("common.the_dealer_shuffles_to_begin_this_deal"));
    case 'SHUFFLING': return { step: 0, title: ui("callbreak.shuffling"), instruction: ui("callbreak.preparing_the_deck"), mine: false };
    case 'AWAITING_CUT': return task(1, ui("callbreak.cut_the_deck"), ui("common.cut_in_half_or_skip_the_cut"));
    case 'AWAITING_DISTRIBUTION': return task(2, ui("callbreak.deal_the_cards"), 'The dealer distributes one card at a time to each player.');
    case 'HAND_REVIEW': return { step: 2, title: snapshot.private?.can_accept_hand ? ui("callbreak.review_your_hand") : ui("callbreak.waiting_for_hand_review"), instruction: snapshot.private?.can_accept_hand ? 'Accept your hand, or request a redeal if eligible.' : ui("common.bidding_begins_when_everyone_accepts"), mine: !!snapshot.private?.can_accept_hand };
    case 'BIDDING': return task(3, ui("callbreak.choose_a_bid"), mine ? 'Choose how many tricks you will win, then confirm.' : ui("common.review_your_cards_while_the_remaining_players_bid"));
    case 'PLAYING': {
      const lead = snapshot.game?.current_trick?.plays[0]?.card.slice(-1);
      const suit = ({ S: 'spades', C: 'clubs', H: 'hearts', D: 'diamonds' } as Record<string, string>)[lead || ''];
      return task(4, ui("callbreak.play_a_card"), mine ? (suit ? ui("callbreak.follow_suit", { "suit": uiLabel(suit).toLowerCase() }) : 'You lead this trick. Select a card, then confirm Play.') : 'Watch the table. Your legal cards light up on your turn.');
    }
    case 'DEAL_COMPLETE': return { step: 5, title: ui("callbreak.deal_complete"), instruction: ui("common.review_the_scores_before_the_next_deal"), mine: false };
    case 'MATCH_COMPLETE': return { step: 5, title: ui("callbreak.match_complete"), instruction: ui("common.final_scores_after_five_deals"), mine: false };
    default: return { step: 0, title: ui("callbreak.preparing_the_deal"), instruction: ui("common.waiting_for_the_table"), mine: false };
  }
}
