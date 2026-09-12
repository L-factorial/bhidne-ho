"""Marriage domain vocabulary, independent of transport and platform."""
from enum import Enum


class CardType(str, Enum):
    STANDARD = "standard"
    MAN = "man"


class GameStatus(str, Enum):
    WAITING = "waiting"
    IN_PROGRESS = "in_progress"
    FINISHED = "finished"


class TurnPhase(str, Enum):
    MUST_DRAW = "must_draw"
    MUST_DISCARD = "must_discard"


class DrawSource(str, Enum):
    STOCK = "stock"
    DISCARD = "discard"


class ActionKind(str, Enum):
    DRAW = "draw"
    DISCARD = "discard"
    SHOW_INITIAL_MELDS = "show_initial_melds"
    SHOW_DUBLEES = "show_dublees"
    FINISH = "finish"


class MeldType(str, Enum):
    PURE_SEQUENCE = "pure_sequence"
    TUNNELA = "tunnela"
    DUBLEE = "dublee"


class QualificationRoute(str, Enum):
    UNQUALIFIED = "unqualified"
    NORMAL = "normal"
    DUBLEE = "dublee"


class AceSequencePolicy(str, Enum):
    LOW_ONLY = "low_only"


class MaalNeighborPolicy(str, Enum):
    CYCLIC = "cyclic"
