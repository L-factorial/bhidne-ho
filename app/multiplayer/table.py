"""In-memory table policy, FIFO waitlist and accepted seat transfers.

The host serializes these synchronous operations under the match lock. Engine
rosters remain historical after a match; rotation seats belong to the next match.
"""
from dataclasses import asdict, dataclass, field
from time import time
from uuid import uuid4

from fastapi import HTTPException


def reject(code, detail):
    raise HTTPException(409, {"code": code, "detail": detail})


@dataclass(frozen=True)
class GameTablePolicy:
    min_players: int
    max_players: int
    fixed_player_count: int | None = None
    requires_explicit_lock: bool = False
    requires_replacement: bool = False
    supports_abandonment: bool = False

    @classmethod
    def for_game(cls, kind, capacity):
        if kind == 'callbreak':
            return cls(capacity, capacity, capacity, requires_replacement=True, supports_abandonment=True)
        return cls(2, capacity, requires_explicit_lock=True)


@dataclass
class SeatOffer:
    offer_id: str
    game_id: str
    seat_id: int
    leaving_player_id: str
    offered_to_player_id: str
    created_at: float
    expires_at: float
    status: str = 'PENDING'


@dataclass
class TableState:
    table_id: str = field(default_factory=lambda: uuid4().hex)
    queue: list[str] = field(default_factory=list)
    phase: str = 'OPEN'
    # Only populated at match completion; never overwrite the engine's roster.
    next_seats: list[str | None] | None = None
    releases: dict[int, str] = field(default_factory=dict)
    offers: dict[str, SeatOffer] = field(default_factory=dict)
    events: list[dict] = field(default_factory=list)
    offer_seconds: float = 30
    published_sequence: int = 0

    def emit(self, event, **payload):
        self.events.append({'sequence': len(self.events) + 1, 'event': event, 'payload': payload})

    def sync(self, game):
        if game.ended:
            self.phase = 'ENDED'
        elif game.finished:
            if self.phase != 'COMPLETED':
                self.phase = 'COMPLETED'
                self.next_seats = [u if u not in game.departed else None for u in game.users]
                self.emit('MATCH_COMPLETED', match_id=game.match_id)
        elif self.phase == 'STARTED' and game.flush_open:
            self.phase = 'OPEN'
            self.emit('ROSTER_OPEN', match_id=game.match_id)

    def seats(self, game):
        if self.next_seats is not None:
            return self.next_seats
        if game.game_type == 'marriage' and game.started:
            return [u if u not in game.departed else None for u in game.users]
        return [u for u in game.users if u not in game.departed]

    def pending(self, seat=None):
        return [offer for offer in self.offers.values() if offer.status == 'PENDING'
                and (seat is None or offer.seat_id == seat)]

    def make_offer(self, game, seat, recipient, now):
        offer = SeatOffer(uuid4().hex, game.match_id, seat, self.releases[seat], recipient, now, now + self.offer_seconds)
        self.offers[offer.offer_id] = offer
        self.emit('SEAT_OFFERED', **asdict(offer))
        return offer

    def advance(self, game, members, now=None):
        now = time() if now is None else now
        self.sync(game)
        for offer in self.pending():
            if self.phase != 'COMPLETED' or offer.offered_to_player_id not in members:
                offer.status = 'CANCELLED'
            elif now >= offer.expires_at:
                offer.status = 'EXPIRED'
            else:
                continue
            if offer.offered_to_player_id in self.queue:
                self.queue.remove(offer.offered_to_player_id)
            self.emit('SEAT_OFFER_' + offer.status, offer_id=offer.offer_id)
        self.queue[:] = [u for u in self.queue if u in members and u not in self.seats(game)]
        if self.phase != 'COMPLETED':
            return
        reserved = {o.offered_to_player_id for o in self.pending()}
        seated = self.seats(game)
        self.queue[:] = [u for u in self.queue if u in members and u not in seated]
        for seat in self.releases:
            if seated[seat - 1] is not None or self.pending(seat):
                continue
            candidate = next((u for u in self.queue if u not in reserved), None)
            if candidate:
                self.make_offer(game, seat, candidate, now)
                reserved.add(candidate)

    def view(self, game, user_id):
        self.sync(game)
        policy = GameTablePolicy.for_game(game.game_type, game.capacity)
        # Historical engine seats do not reserve membership after End.
        seats = [] if game.ended else self.seats(game)
        seated = user_id in seats
        count = sum(u is not None for u in seats)
        host = next((u for u in seats if u is not None), None) == user_id
        open_ = self.phase == 'OPEN'
        valid = policy.min_players <= count <= policy.max_players
        pending = self.pending()
        rules_pending = bool(game.rule_proposal and game.rule_proposal['status'] == 'PENDING')
        occupied = [{'seat_id': (game.flush_seats[u] if game.game_type == 'flush' else i + 1), 'user_id': u}
                    for i, u in enumerate(seats) if u is not None]
        return {'table_id': self.table_id, 'phase': self.phase, **asdict(policy),
            'seated_players': occupied, 'queue': list(self.queue),
            'current_user': {
                'is_seated': seated, 'seat_id': next((p['seat_id'] for p in occupied if p['user_id'] == user_id), None),
                'is_queued': user_id in self.queue,
                'queue_position': self.queue.index(user_id) + 1 if user_id in self.queue else None,
                'can_join': open_ and not seated and count < policy.max_players,
                'can_queue': self.phase != 'ENDED' and not seated and user_id not in self.queue,
                'can_lock': policy.requires_explicit_lock and open_ and host and valid and not rules_pending,
                'can_start': host and valid and not rules_pending and not pending and not self.releases and
                    (self.phase == 'LOCKED' if policy.requires_explicit_lock else open_),
                'can_leave_seat': seated and self.phase in ('OPEN', 'COMPLETED', 'ENDED'),
                'can_abandon_match': seated and self.phase == 'STARTED' and policy.supports_abandonment,
                'is_in_active_match': seated and self.phase == 'STARTED',
                'can_next_match': host and self.phase == 'COMPLETED' and
                    (valid if policy.requires_replacement else 1 <= count <= policy.max_players) and not self.releases,
                'replacement_offer': next((asdict(o) for o in pending if o.offered_to_player_id == user_id), None),
                'can_invite_replacement': self.phase == 'COMPLETED' and bool(self.releases) and not self.queue and
                    (host or user_id in self.releases.values()),
            },
            'released_seats': [{'seat_id': seat, 'leaving_player_id': user} for seat, user in self.releases.items()],
            'offers': [asdict(o) for o in self.offers.values() if user_id in (o.leaving_player_id, o.offered_to_player_id) or host],
            'events': self.events[-50:]}
