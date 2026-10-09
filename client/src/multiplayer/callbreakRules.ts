export type CallBreakMatchRules = {
  instant_win_enabled: boolean; instant_win_bid: number;
  perfect_bid_enabled: boolean; perfect_bid: number;
  bonus_conversion_enabled: boolean; bonus_per_point: number;
  double_win_enabled: boolean; double_win_threshold: number; winner_multiplier: number;
  negative_payment_enabled: boolean; negative_threshold: number; negative_multiplier: number;
};

export function defaultCallBreakRules(players: number): CallBreakMatchRules {
  return { instant_win_enabled: false, instant_win_bid: players === 5 ? 6 : 8,
    perfect_bid_enabled: false, perfect_bid: 1,
    bonus_conversion_enabled: false, bonus_per_point: players === 5 ? 8 : 10,
    double_win_enabled: false, double_win_threshold: players === 5 ? 15 : 20, winner_multiplier: 2,
    negative_payment_enabled: false, negative_threshold: 0, negative_multiplier: 2 };
}

export const callBreakRuleGroups = [
  { toggle: 'instant_win_enabled', values: ['instant_win_bid'], help: 'instant_help' },
  { toggle: 'perfect_bid_enabled', values: ['perfect_bid'], help: 'perfect_help' },
  { toggle: 'bonus_conversion_enabled', values: ['bonus_per_point'], help: 'bonus_help' },
  { toggle: 'double_win_enabled', values: ['double_win_threshold', 'winner_multiplier'], help: 'double_help' },
  { toggle: 'negative_payment_enabled', values: ['negative_threshold', 'negative_multiplier'], help: 'negative_help' },
] as const;

export function formatCallBreakScore(units: number, scale = 10): string {
  // Keep every Bonus visible even with a divisor that has a recurring decimal.
  if (scale === 10) return (units / scale).toFixed(1);
  const whole = Math.floor(units / scale), remainder = units - whole * scale;
  return remainder ? `${whole} + ${remainder}/${scale}` : String(whole);
}
