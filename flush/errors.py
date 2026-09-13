"""Safe domain failures, independent of HTTP and platform models."""


class FlushError(Exception):
    code = 'FLUSH_ERROR'


class InvalidActionError(FlushError):
    code = 'INVALID_ACTION'


class InvalidTurnError(FlushError):
    code = 'INVALID_TURN'


class InsufficientChipsError(FlushError):
    code = 'INSUFFICIENT_CHIPS'


class UnsupportedRuleError(FlushError):
    code = 'UNSUPPORTED_RULE'


class InvariantError(FlushError):
    code = 'INVARIANT_FAILURE'
