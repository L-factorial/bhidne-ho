export type FlushRules = {
  boot_amount: number; initial_blind_bet: number;
  minimum_bet_rounds_before_side_show: number; blind_to_seen_bet_multiplier: number;
  minimum_blind_rounds_before_show: number; maximum_active_players_for_blind_show: number;
  allow_side_show: boolean; allow_blind_show: boolean; allow_seen_show: boolean; show_only_when_two_players_remain: boolean;
  minimum_players: number; maximum_players: number; show_cost_multiplier: number;
  sequence_ace_policy: 'akq_first_a23_second' | 'a23_first' | 'a23_lowest';
  tie_policy: 'requester_loses' | 'split';
};
export type FlushSettings = { rules: FlushRules; starting_chips: number; rules_revision: number; locked: boolean };
export type FlushView = {
  folds?: { sequence: number; revision: number; player_id: string }[];
  participants?: { player_id: string; display_name: string }[];
  bets?: import('./flushTable').FlushBet[];
  public: { pending_show: { requester_id: string; target_id: string } | null; revealed_hands: { player_id: string; cards: {rank: number; suit: string}[] }[]; round_number: number; next_dealer_id: string | null; round_results: { round_number: number; winner_ids: string[]; net_changes: { player_id: string; amount: number }[] }[]; pending_side_show: { requester_id: string; target_id: string; revision: number } | null; status: string; current_player_id: string | null; current_blind_bet: number; current_seen_bet: number; pot: number;
    players: { player_id: string; status: string; visibility: string; chips: number; blind_bet_count: number; turn_bet_count: number; total_contribution: number }[];
    settlement: { winner_ids: string[]; payouts: { player_id: string; amount: number }[];
      shown_hands: { player_id: string; cards: { rank: number; suit: string }[] }[] } | null };
  private: { side_show: { opponent_id: string; opponent_cards: string[]; won: boolean; revision: number } | null; cards: string[]; actions: { kinds: string[]; required_bet: number; show_cost: number;
    side_show_target_id: string | null; side_show: { allowed: boolean; reason: string | null };
    see: { allowed: boolean; reason: string | null }; show: { allowed: boolean; reason: string | null } } } | null;
};
