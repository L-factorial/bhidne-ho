from dataclasses import dataclass
from typing import TypeAlias


@dataclass(frozen=True)
class Bet:
    amount: int


@dataclass(frozen=True)
class SeeCards:
    pass


@dataclass(frozen=True)
class Fold:
    pass


@dataclass(frozen=True)
class Show:
    pass


@dataclass(frozen=True)
class RequestSideShow:
    pass


@dataclass(frozen=True)
class AcceptSideShow:
    pass


@dataclass(frozen=True)
class DeclineSideShow:
    pass


@dataclass(frozen=True)
class DealCards:
    pass


@dataclass(frozen=True)
class CutDeck:
    position: int


@dataclass(frozen=True)
class SkipCut:
    pass


@dataclass(frozen=True)
class StartNextRound:
    pass


@dataclass(frozen=True)
class RevealCards:
    pass


PlayerAction: TypeAlias = RevealCards | StartNextRound | DealCards | CutDeck | SkipCut | Bet | SeeCards | Fold | Show | RequestSideShow | AcceptSideShow | DeclineSideShow
