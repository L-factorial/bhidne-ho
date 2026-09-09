"""Immutable trick inputs using local player IDs 1 through player_count."""

from dataclasses import dataclass

from card_utils import Card


@dataclass(frozen=True)
class Play:
    player_id: int
    card: Card

    def __post_init__(self) -> None:
        if type(self.player_id) is not int or not 1 <= self.player_id <= 5:
            raise ValueError("Player ID must be an integer from 1 to 5.")
        if not isinstance(self.card, Card):
            raise ValueError("A play requires a Card.")


@dataclass(frozen=True)
class Trick:
    player_count: int
    leader: int
    plays: tuple[Play, ...] = ()

    def __post_init__(self) -> None:
        if type(self.player_count) is not int or self.player_count not in (4, 5):
            raise ValueError("A trick requires four or five players.")
        if type(self.leader) is not int or not 1 <= self.leader <= self.player_count:
            raise ValueError("Leader must identify a player in this trick.")
        object.__setattr__(self, "plays", tuple(self.plays))
        if len(self.plays) > self.player_count:
            raise ValueError("Too many plays in a trick.")
        seen = set()
        for index, play in enumerate(self.plays):
            if not isinstance(play, Play):
                raise ValueError("Trick entries must be Play values.")
            expected = (self.leader - 1 + index) % self.player_count + 1
            if play.player_id != expected:
                raise ValueError("Plays must follow player order, starting with the leader.")
            if play.card in seen:
                raise ValueError("A card cannot appear twice in a trick.")
            seen.add(play.card)

    @property
    def complete(self) -> bool:
        return len(self.plays) == self.player_count

    @property
    def current_player(self) -> int | None:
        if self.complete:
            return None
        return (self.leader - 1 + len(self.plays)) % self.player_count + 1
