"""Shared table lifecycle around the existing hosted engines.

All mutations, expiry and promotion happen under catalog -> match lock order.
No disconnect or navigation path invokes seat release or abandonment.
"""
import asyncio
from copy import deepcopy
from time import time

from fastapi import HTTPException

from app.multiplayer.table import GameTablePolicy, reject


class GameTableLifecycle:
    async def _advance_table(self, game):
        self._sync_proposal(game)
        previous_phase = game.table.phase
        game.table.advance(game, await self.rooms.members(game.room_id))
        if previous_phase == 'STARTED' and game.table.phase in ('OPEN', 'COMPLETED', 'ENDED'):
            await self._release_durable_players(game)
        if game.table.pending() and game.table.table_id not in self._offer_tasks:
            self._offer_tasks[game.table.table_id] = asyncio.create_task(self._expire_offers(game))

    async def _expire_offers(self, game):
        try:
            while True:
                await asyncio.sleep(1)
                async with game.lock:
                    if not self._contains(game):
                        return
                    game.table.advance(game, await self.rooms.members(game.room_id))
                    if game.table.published_sequence < len(game.table.events):
                        await self._publish(game)
                    if not game.table.pending():
                        return
        finally:
            self._offer_tasks.pop(game.table.table_id, None)

    def _promote(self, game):
        if game.table.phase != 'OPEN':
            return
        while game.table.queue and len(game.users) < game.capacity:
            user = game.table.queue.pop(0)
            self._seat_user(game, user)
            game.table.emit('QUEUE_PROMOTED', user_id=user, match_id=game.match_id)

    def _seat_user(self, game, user):
        if game.game_type == 'flush' and user not in game.flush_seats:
            game.flush_seats[user] = max(game.flush_seats.values(), default=0) + 1
        if user in game.table.queue:
            game.table.queue.remove(user)
        game.users.append(user)

    async def _release_seat(self, game, user):
        table = game.table
        table.sync(game)
        seats = table.seats(game)
        if user not in seats:
            return
        policy = GameTablePolicy.for_game(game.game_type, game.capacity)
        if table.phase == 'STARTED':
            reject('ACTIVE_MATCH_EXISTS', 'Use the explicit active-match departure action.')
        if table.phase == 'LOCKED':
            reject('ROSTER_LOCKED', 'The locked roster remains reserved until the game is ended.')
        if table.phase == 'COMPLETED' and policy.requires_replacement:
            seat = seats.index(user) + 1
            table.next_seats[seat - 1] = None
            table.releases[seat] = user
            game.departed.add(user)
            table.emit('SEAT_RELEASED', seat_id=seat, user_id=user, match_id=game.match_id)
            await self._advance_table(game)
            return
        if game.started and not game.flush_open:
            game.departed.add(user)
            if table.next_seats is not None:
                table.next_seats[seats.index(user)] = None
        else:
            game.users.remove(user)
            table.phase = 'OPEN'  # A changed formation must be explicitly locked again.
            self._promote(game)
            if not game.users:
                game.ended = True
                table.phase = 'ENDED'
        table.emit('SEAT_RELEASED', user_id=user, match_id=game.match_id)

    async def room_departure(self, room_id, user_id):
        """Called by RoomLifecycle with the membership guard already held."""
        for game in self._room_games(room_id):
            await self._advance_table(game)
            if user_id in game.table.seats(game) and game.table.phase == 'STARTED':
                reject('ACTIVE_GAME_EXISTS', 'Leave the active game explicitly before leaving the room.')
            self._remove_from_queue(game, user_id)
            await self._release_seat(game, user_id)
            await self._advance_table(game)
            await self._publish(game)

    def _remove_from_queue(self, game, user):
        if user in game.table.queue:
            game.table.queue.remove(user)
        for offer in game.table.pending():
            if offer.offered_to_player_id == user:
                offer.status = 'CANCELLED'
                game.table.emit('SEAT_OFFER_CANCELLED', offer_id=offer.offer_id)

    async def table_command(self, room_id, user_id, match_id, command, *, offer_id=None, seat_id=None, recipient=None):
        async with self._catalog_lock:
            if command == 'next-match':
                replacement = next((g for g in self._room_games(room_id) if g.previous_match_id == match_id), None)
                if replacement:
                    return self._snapshot(replacement, user_id)
            game = self._get(room_id, match_id)
            async with game.lock:
                await self._member(room_id, user_id)
                if command == 'next-match' and game.previous_match_id == match_id:
                    return self._snapshot(game, user_id)
                if game.match_id != match_id or not self._contains(game):
                    reject('GAME_CHANGED', 'The match changed. Refresh the table.')
                await self._advance_table(game)
                table = game.table
                policy = GameTablePolicy.for_game(game.game_type, game.capacity)
                view = table.view(game, user_id)
                me = view['current_user']
                host = next((u for u in table.seats(game) if u is not None), None) == user_id
                if command == 'join-queue':
                    self._ensure_available(user_id, game)
                    if me['is_seated']:
                        reject('ALREADY_SEATED', 'You already have a seat.')
                    if table.phase == 'ENDED':
                        reject('GAME_ENDED', 'This table has ended.')
                    if user_id not in table.queue:
                        table.queue.append(user_id)
                        table.emit('QUEUE_JOINED', user_id=user_id)
                elif command == 'leave-queue':
                    self._remove_from_queue(game, user_id)
                elif command == 'lock':
                    if game.rule_proposal and game.rule_proposal['status'] == 'PENDING':
                        reject('RULE_APPROVAL_PENDING', 'Resolve the proposed rules before locking.')
                    if not host:
                        raise HTTPException(403, 'Only the table host can lock the roster.')
                    if not policy.requires_explicit_lock:
                        reject('LOCK_NOT_REQUIRED', 'This table locks when the match starts.')
                    if table.phase == 'LOCKED':
                        return self._snapshot(game, user_id)
                    if table.phase != 'OPEN':
                        reject('ROSTER_CLOSED', 'This roster cannot be locked now.')
                    if not policy.min_players <= len(game.users) <= policy.max_players:
                        reject('NOT_ENOUGH_PLAYERS', 'Seat enough players before locking the roster.')
                    if not set(game.users).issubset(await self.rooms.members(room_id)):
                        reject('INVALID_ROSTER', 'All seated players must be room members.')
                    await self._reserve_table_players(game)
                    table.phase = 'LOCKED'
                    table.emit('GAME_LOCKED', match_id=match_id)
                elif command == 'leave-seat':
                    await self._release_seat(game, user_id)
                elif command == 'invite-seat':
                    if not me['can_invite_replacement'] or seat_id not in table.releases:
                        reject('INVITATION_NOT_ALLOWED', 'The host or departing player may invite after the queue is empty.')
                    if not host and table.releases[seat_id] != user_id:
                        raise HTTPException(403, 'You may only invite a replacement for your own seat.')
                    if table.pending(seat_id):
                        existing = table.pending(seat_id)[0]
                        if existing.offered_to_player_id != recipient:
                            reject('OFFER_PENDING', 'A seat offer is already pending.')
                    else:
                        members = await self.rooms.members(room_id)
                        if recipient not in members or recipient in table.seats(game) or any(o.offered_to_player_id == recipient for o in table.pending()):
                            reject('INELIGIBLE_RECIPIENT', 'Choose an unseated room member without another pending offer.')
                        table.make_offer(game, seat_id, recipient, time())
                elif command in ('accept-seat', 'decline-seat'):
                    offer = table.offers.get(offer_id)
                    if not offer or offer.game_id != match_id or offer.offered_to_player_id != user_id:
                        raise HTTPException(403, 'This seat offer does not belong to you.')
                    expected = 'ACCEPTED' if command == 'accept-seat' else 'DECLINED'
                    if offer.status == expected:
                        return self._snapshot(game, user_id)
                    if offer.status != 'PENDING' or table.phase != 'COMPLETED':
                        reject('OFFER_NOT_PENDING', 'This offer is no longer available.')
                    if command == 'accept-seat':
                        self._ensure_available(user_id, game)
                        if user_id in table.seats(game) or table.next_seats[offer.seat_id - 1] is not None:
                            reject('SEAT_UNAVAILABLE', 'This seat is no longer transferable.')
                        table.next_seats[offer.seat_id - 1] = user_id
                        del table.releases[offer.seat_id]
                    if user_id in table.queue:
                        table.queue.remove(user_id)
                    offer.status = expected
                    table.emit('SEAT_OFFER_' + expected, offer_id=offer.offer_id, seat_id=offer.seat_id,
                        leaving_player_id=offer.leaving_player_id, user_id=user_id)
                elif command == 'abandon':
                    if game.ended:
                        # A conflict dialog may outlive the creator's End action.
                        # Treat the old departure as a release, never a new abandonment.
                        await self._release_seat(game, user_id)
                        await self._advance_table(game)
                        await self._publish(game)
                        return self._snapshot(game, user_id)
                    if not me['can_abandon_match']:
                        if user_id in game.departed and game.ended:
                            return self._snapshot(game, user_id)
                        reject('ABANDON_NOT_ALLOWED', 'You are not playing an active match that supports abandonment.')
                    # TODO: Penalty policy intentionally deferred. No score/chip deductions.
                    # End the incomplete match: the engine has no safe live seat substitution.
                    game.departed.add(user_id)
                    await self._release_durable_players(game)
                    game.ended = True
                    table.phase = 'ENDED'
                    table.emit('PLAYER_LEFT_ACTIVE_MATCH', user_id=user_id, match_id=match_id,
                        reason='ABANDON_MATCH', penalty_policy='DEFERRED')
                    table.queue.clear()
                elif command == 'next-match':
                    if not me['can_next_match']:
                        reject('NEXT_MATCH_NOT_READY', 'Fill all required seats and resolve replacement offers first.')
                    members = await self.rooms.members(room_id)
                    roster = [u for u in table.seats(game) if u is not None]
                    if not set(roster).issubset(members):
                        reject('INVALID_ROSTER', 'Every seat must belong to a room member.')
                    new = type(game)(room_id, game.capacity, roster, name=game.name, game_type=game.game_type,
                        settings=dict(game.settings), marriage_scoring=game.marriage_scoring, table=deepcopy(table),
                        previous_match_id=game.match_id)
                    await self._release_durable_players(game)
                    # Old snapshots and departures must not mutate the next match's roster.
                    table = new.table
                    table.phase = 'OPEN'
                    table.next_seats = None
                    table.releases.clear()
                    game.ended = True
                    self.tables.setdefault(room_id, {})[new.match_id] = new
                    self.games[room_id] = new
                    table.emit('NEXT_MATCH_READY', match_id=new.match_id)
                    await self._publish(new)
                    return self._snapshot(new, user_id)
                else:
                    raise HTTPException(422, 'Unknown table command.')
                await self._advance_table(game)
                await self._publish(game)
                return self._snapshot(game, user_id)
