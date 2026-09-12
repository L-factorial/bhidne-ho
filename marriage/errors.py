"""Domain rejection categories; no HTTP codes or platform exception types."""


class MarriageError(Exception):
    code = "MARRIAGE_ERROR"


class InvalidTurnError(MarriageError):
    code = "INVALID_TURN"


class InvalidActionError(MarriageError):
    code = "INVALID_ACTION"


class InvalidMeldError(MarriageError):
    code = "INVALID_MELD"


class NoDrawableCardError(MarriageError):
    code = "NO_DRAWABLE_CARD"


class TipluUnavailableError(MarriageError):
    code = "TIPLU_UNAVAILABLE"


class UnsupportedRuleError(MarriageError):
    code = "UNSUPPORTED_RULE"


class CardConservationError(MarriageError):
    code = "CARD_CONSERVATION"
