"""Optional local pre-game agreement coordinator, using only player IDs.

A platform must authenticate the actor and map its user to a player before
calling this module. No accounts, room membership or delivery are handled here.
"""

from dataclasses import dataclass, replace

from .config import GameConfig
from .engine import create_match
from .game import MatchState


@dataclass(frozen=True)
class MatchSetup:
    config: GameConfig
    admin: int = 1
    anyone_can_edit: bool = True
    revision: int = 0
    accepted: tuple[int, ...] = ()
    started: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.config, GameConfig):
            raise ValueError("A GameConfig is required.")
        if type(self.admin) is not int or self.admin not in self.config.players:
            raise ValueError("Admin must be a player.")
        if type(self.anyone_can_edit) is not bool:
            raise ValueError("Editing permission must be boolean.")
        object.__setattr__(self, "accepted", tuple(self.accepted))

    def _check(self, actor: int, revision: int) -> None:
        if self.started:
            raise ValueError("Settings are frozen after start.")
        if type(actor) is not int or actor not in self.config.players:
            raise ValueError("Actor must be a participant.")
        if type(revision) is not int or revision != self.revision:
            raise ValueError("Stale settings revision.")

    def propose(self, actor: int, config: GameConfig, *, expected_revision: int,
                anyone_can_edit: bool | None = None) -> "MatchSetup":
        self._check(actor, expected_revision)
        if not self.anyone_can_edit and actor != self.admin:
            raise ValueError("Only the admin may propose settings.")
        if not isinstance(config, GameConfig) or config.player_count != self.config.player_count:
            raise ValueError("Create a fresh setup to change the roster size.")
        permission = self.anyone_can_edit if anyone_can_edit is None else anyone_can_edit
        return replace(self, config=config, anyone_can_edit=permission,
                       revision=self.revision + 1, accepted=())

    def accept(self, actor: int, *, expected_revision: int) -> "MatchSetup":
        self._check(actor, expected_revision)
        return replace(self, accepted=tuple(sorted(set(self.accepted) | {actor})))

    def start(self, actor: int, *, expected_revision: int,
              initial_dealer: int = 1) -> tuple["MatchSetup", MatchState]:
        self._check(actor, expected_revision)
        if actor != self.admin:
            raise ValueError("Admin starts the agreed match.")
        if self.accepted != self.config.players:
            raise ValueError("Every participant must accept these settings.")
        return replace(self, started=True), create_match(self.config, initial_dealer=initial_dealer)
