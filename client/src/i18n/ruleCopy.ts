import { ui, uiLabel } from './copy.ts';

// Stable protocol keys map to presentation labels; the configuration stays untouched.
const fields: Record<string, string> = {
  "allow_side_show": "Allow private side-show",
  "require_minimum_bets_by_everyone": "Require minimum bets by every remaining player",
  "minimum_bets_before_show": "Minimum bets per player before showdown",
  "boot_amount": "Boot per player (0 disables)",
  "initial_blind_bet": "Blind bet",
  "minimum_bet_rounds_before_side_show": "Betting cycles before side-show",
  "blind_to_seen_bet_multiplier": "Seen bet multiplier",
  "minimum_blind_rounds_before_show": "Personal blind bets before show",
  "maximum_active_players_for_blind_show": "Blind show: at most N active players",
  "allow_blind_show": "Allow blind show",
  "allow_seen_show": "Allow seen show",
  "show_only_when_two_players_remain": "Show only with two players",
  "minimum_players": "Minimum players",
  "maximum_players": "Maximum players",
  "show_cost_multiplier": "Show cost multiplier (0 is free)",
  "sequence_ace_policy": "Ace sequence order",
  "tie_policy": "Equal hands",
  "tiplu": "Tiplu",
  "jhiplu": "Jhiplu",
  "poplu": "Poplu",
  "alter": "Alter",
  "man": "Joker",
  "marriage": "Marriage combination",
  "tunnela_bonus": "Extra points per Tunnela",
  "seen_payment": "Loser payment: Maal seen",
  "unseen_payment": "Loser payment: Maal unseen",
  "dublee_win_bonus": "Extra per loser: Dublee win",
  "weak_hand_enabled": "Allow weak hand redeal",
  "no_spades_enabled": "Allow no spades redeal",
  "payments": "Placement payments",
  "initial_tunnela_declaration": "Initial Tunnela declaration",
  "tunnela_scope": "Tunnela bonus scope",
  "maal_requires_seen": "Maal points require seeing Maal",
  "rules_revision": "Rules revision",
  "rules": "Rules",
  "scoring": "Scoring"
};

export function ruleFieldLabel(path: string): string {
  const key = path.split('.').at(-1) || path;
  const callbreakKeys = ['match_rules', 'instant_win_enabled', 'instant_win_bid', 'perfect_bid_enabled', 'perfect_bid', 'bonus_conversion_enabled', 'bonus_per_point', 'double_win_enabled', 'double_win_threshold', 'winner_multiplier', 'negative_payment_enabled', 'negative_threshold', 'negative_multiplier'] as const;
  const match = callbreakKeys.find(value => value === key);
  if (match) return ui(`callbreak.${match}`);
  return uiLabel(fields[key] || key.replaceAll('_', ' '));
}

const values: Record<string, string> = {
  akq_first_a23_second: 'AKQ first, A23 second', a23_first: 'A23 first',
  a23_lowest: 'A23 lowest', requester_loses: 'Show requester loses', split: 'Split pot',
  off: 'None', shown: 'Shown Tunnelas', hand: 'All final Tunnelas',
};
export function ruleValueLabel(value: string): string {
  return uiLabel(values[value] || value);
}
