from enum import Enum, IntEnum


class GameStatus(str, Enum):
    WAITING = 'waiting'
    AWAITING_DEAL = 'awaiting_deal'
    AWAITING_CUT = 'awaiting_cut'
    IN_PROGRESS = 'in_progress'
    FINISHED = 'finished'


class PlayerStatus(str, Enum):
    ACTIVE = 'active'
    FOLDED = 'folded'
    OUT = 'out'


class Visibility(str, Enum):
    BLIND = 'blind'
    SEEN = 'seen'


class AceSequencePolicy(str, Enum):
    AKQ_FIRST_A23_SECOND = 'akq_first_a23_second'
    A23_FIRST = 'a23_first'
    A23_LOWEST = 'a23_lowest'


class TiePolicy(str, Enum):
    REQUESTER_LOSES = 'requester_loses'
    SPLIT = 'split'


class TerminationReason(str, Enum):
    LAST_PLAYER_REMAINING = 'last_player_remaining'
    SHOW = 'show'
    SHOW_FOLD = 'show_fold'


class FlushHandRank(IntEnum):
    HIGH_CARD = 1
    PAIR = 2
    COLOR = 3
    SEQUENCE = 4
    PURE_SEQUENCE = 5
    TRAIL = 6
