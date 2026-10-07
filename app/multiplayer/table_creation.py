"""Resolve table capacity from game rules when no explicit roster size is given."""
from marriage.rules import MarriageRules
from flush.rules import FlushRulesConfig


def table_capacity(kind, requested=None):
    if kind == 'marriage':
        minimum, maximum = MarriageRules.min_players, MarriageRules.max_players
    elif kind == 'flush':
        rules = FlushRulesConfig(boot_amount=1)
        minimum, maximum = rules.minimum_players, rules.maximum_players
    elif kind == 'callbreak':
        minimum, maximum = 4, 5
    else:
        raise ValueError('Unsupported game type.')
    capacity = (4 if kind == 'callbreak' else maximum) if requested is None else requested
    if type(capacity) is not int or not minimum <= capacity <= maximum:
        raise ValueError('Unsupported player count.')
    return capacity
