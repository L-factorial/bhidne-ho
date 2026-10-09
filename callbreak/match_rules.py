"""Optional match rules, frozen at start. Integer score units avoid rounding."""
from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class MatchRules:
    instant_win_enabled: bool = False
    instant_win_bid: int = 8
    perfect_bid_enabled: bool = False
    perfect_bid: int = 1
    bonus_conversion_enabled: bool = False
    bonus_per_point: int = 10
    double_win_enabled: bool = False
    double_win_threshold: int = 20
    winner_multiplier: int = 2
    negative_payment_enabled: bool = False
    negative_threshold: int = 0
    negative_multiplier: int = 2

    def __post_init__(self):
        for key, value in asdict(self).items():
            if key.endswith('_enabled'):
                if type(value) is not bool:
                    raise ValueError('Rule switches must be booleans.')
            elif type(value) is not int:
                raise ValueError('Rule values must be integers.')
        if not 1 <= self.instant_win_bid <= 13 or not 1 <= self.perfect_bid <= 13:
            raise ValueError('Bid targets must be between 1 and the deal trick count.')
        if not 1 <= self.bonus_per_point <= 100:
            raise ValueError('Bonus per point must be between 1 and 100.')
        if not 1 <= self.double_win_threshold <= 1000 or not -1000 <= self.negative_threshold <= 0:
            raise ValueError('Invalid payment score threshold.')
        if not 2 <= self.winner_multiplier <= 10 or not 2 <= self.negative_multiplier <= 10:
            raise ValueError('Payment multipliers must be between 2 and 10.')

    @property
    def score_scale(self):
        return self.bonus_per_point if self.bonus_conversion_enabled else 10

    def validate_for(self, player_count, payments=None):
        maximum = 52 // player_count
        if self.instant_win_bid > maximum or self.perfect_bid > maximum:
            raise ValueError('Bid targets cannot exceed the deal trick count.')
        if payments is None:
            return
        if len(payments) < player_count - 1 or any(type(p) is not int or p < 0 for p in payments):
            raise ValueError('Invalid placement payments.')
        amounts = payments[:player_count - 1]
        if self.instant_win_enabled and sum(amounts) % (player_count - 1):
            raise ValueError('Instant-win payments must total a multiple of the number of opponents.')
        if self.perfect_bid_enabled:
            for winners in range(2, player_count):
                if winners * self.perfect_bid <= maximum and sum(amounts[winners - 1:]) % winners:
                    raise ValueError('Remaining placement payments must split equally between every possible group of perfect-bid winners.')
            # Equal lower scores share the payments of their tied places.
            # Require exact integer debts rather than rounding against a seat.
            for start in range(len(amounts)):
                for size in range(2, len(amounts) - start + 1):
                    if sum(amounts[start:start + size]) % size:
                        raise ValueError('Placement payments must also divide equally between tied opponents.')


def rules_from_settings(settings, player_count):
    values = settings.get('match_rules')
    rules = MatchRules(**values) if values is not None else MatchRules(
        instant_win_bid=8 if player_count == 4 else 6,
        bonus_per_point=10 if player_count == 4 else 8,
        double_win_threshold=20 if player_count == 4 else 15)
    rules.validate_for(player_count, settings.get('payments'))
    return rules
