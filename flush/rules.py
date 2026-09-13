from dataclasses import dataclass
from typing import ClassVar

from .enums import AceSequencePolicy, TiePolicy
from .errors import UnsupportedRuleError


def integer(value, name, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError(f'{name} must be an integer >= {minimum}.')


@dataclass(frozen=True)
class FlushRulesConfig:
    boot_amount: int
    initial_blind_bet: int = 1
    minimum_bet_rounds_before_side_show: int = 3
    blind_to_seen_bet_multiplier: int = 2
    minimum_blind_rounds_before_show: int = 3
    maximum_active_players_for_blind_show: int = 2
    allow_blind_show: bool = True
    allow_seen_show: bool = True
    allow_side_show: bool = False
    show_only_when_two_players_remain: bool = True
    minimum_players: int = 2
    maximum_players: int = 10
    sequence_ace_policy: AceSequencePolicy = AceSequencePolicy.AKQ_FIRST_A23_SECOND
    tie_policy: TiePolicy = TiePolicy.REQUESTER_LOSES
    show_cost_multiplier: int = 1
    ruleset_id: ClassVar[str] = 'flush-v1'

    def __post_init__(self):
        for name in ('boot_amount', 'minimum_bet_rounds_before_side_show',
                     'minimum_blind_rounds_before_show', 'show_cost_multiplier'):
            integer(getattr(self, name), name)
        for name in ('initial_blind_bet', 'blind_to_seen_bet_multiplier',
                     'maximum_active_players_for_blind_show'):
            integer(getattr(self, name), name, 1)
        integer(self.minimum_players, 'minimum_players', 2)
        integer(self.maximum_players, 'maximum_players', self.minimum_players)
        if self.maximum_players > 10:
            raise ValueError('Flush supports at most 10 players.')
        for name in ('allow_blind_show', 'allow_seen_show', 'allow_side_show', 'show_only_when_two_players_remain'):
            if type(getattr(self, name)) is not bool:
                raise ValueError(f'{name} must be a boolean.')
        if not self.show_only_when_two_players_remain:
            raise UnsupportedRuleError('Show requires exactly two active players.')
        if self.allow_blind_show and self.maximum_active_players_for_blind_show < 2:
            raise ValueError('Blind show requires an active-player maximum of at least two.')
        if not isinstance(self.sequence_ace_policy, AceSequencePolicy):
            raise ValueError('Unsupported Ace sequence policy.')
        if not isinstance(self.tie_policy, TiePolicy):
            raise ValueError('Unsupported tie policy.')
