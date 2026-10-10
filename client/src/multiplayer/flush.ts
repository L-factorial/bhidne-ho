export type FlushRules = {
  allow_multiplayer_blind_show: boolean; minimum_rounds_before_multiplayer_blind_show: number;
  trial_bonus: number; ace_trial_bonus: number | null;
  require_minimum_bets_by_everyone: boolean; minimum_bets_before_show: number;
  boot_amount: number; initial_blind_bet: number;
  minimum_bet_rounds_before_side_show: number; blind_to_seen_bet_multiplier: number;
  minimum_blind_rounds_before_show: number; maximum_active_players_for_blind_show: number;
  allow_side_show: boolean; allow_blind_show: boolean; allow_seen_show: boolean; show_only_when_two_players_remain: boolean;
  minimum_players: number; maximum_players: number; show_cost_multiplier: number;
  sequence_ace_policy: 'akq_first_a23_second' | 'a23_first' | 'a23_lowest';
  tie_policy: 'requester_loses' | 'split';
};
export type FlushSettings = { rules: FlushRules; rules_revision: number; locked: boolean };
export type FlushView = {
  history?: { sequence: number; revision: number; round_number: number; kind: string; player_id: string | null; amount: number; target_player_id: string | null; loser_player_id: string | null; winner_ids: string[]; visibility?: 'seen' | 'blind' | null; bet_number?: number | null }[];
  side_show_events?: {sequence:number;revision:number;kind:string;player_id:string;target_player_id:string}[];
  folds?: { sequence: number; revision: number; player_id: string }[];
  participants?: { player_id: string; display_name: string }[];
  bets?: import('./flushTable').FlushBet[];
  public: { dealer_id?: string; pending_show: { requester_id: string; target_id: string } | null; revealed_hands: { player_id: string; cards: {rank: number; suit: string}[] }[]; round_number: number; next_dealer_id: string | null; round_results: { round_number: number; winner_ids: string[]; net_changes: { player_id: string; amount: number }[] }[]; pending_side_show: { requester_id: string; target_id: string; revision: number; accepted?: boolean } | null; status: string; current_player_id: string | null; current_blind_bet: number; current_seen_bet: number; pot: number;
    players: { player_id: string; status: string; visibility: string; blind_bet_count: number; turn_bet_count: number; total_contribution: number }[];
    settlement: { salami_transfers?: {player_id:string;amount:number}[]; winner_ids: string[]; payouts: { player_id: string; amount: number }[];
      shown_hands: { player_id: string; cards: { rank: number; suit: string }[] }[] } | null };
  private: { side_show: { opponent_id: string; opponent_cards: string[]; won: boolean; revision: number } | null; cards: string[]; actions: { kinds: string[]; required_bet: number; show_cost: number;
    side_show_target_id: string | null; side_show: { allowed: boolean; reason: string | null };
    see: { allowed: boolean; reason: string | null }; show: { allowed: boolean; reason: string | null } } } | null;
};
