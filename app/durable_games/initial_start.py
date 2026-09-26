"""Detached first-engine construction, matching the hosted manual start policies.

No database, transport, ledger, timer or host registry effects occur here. Random
state and controller outputs become authoritative only with the caller's commit.
"""
from typing import Literal
from uuid import UUID

from callbreak import GameConfig, create_match
from callbreak.house_rules import RedealPolicy
from marriage import MarriageGameEngine
from marriage.rules import MarriageRules
from flush import FlushGameEngine
from app.adapters.marriage import MarriageAdapter, PlayerCommand as MarriageCommand, AdapterResult as MarriageResult
from app.adapters.flush import FlushAdapter, PlayerCommand as FlushCommand, AdapterResult as FlushResult
from app.games.base import GameCommandRejected
from app.multiplayer.table import GameTablePolicy
from app.runtime.command_runtime import OutgoingEvent
from app.test_games.marriage import HostedMarriageTarget
from app.test_games.flush import HostedFlushTarget

from .checkpoints import Record, Nonnegative


class InitialStartPayload(Record):
    play_mode: Literal['manual'] = 'manual'
    rules_revision: Nonnegative | None = None


def start_rejection(game, actor, payload, *, allow_finished_flush=False):
    if game.started and not (allow_finished_flush and game.flush_open):
        return 'This match has already started.'
    if not game.users or actor != game.users[0]:
        return 'Only the table host can start the match.'
    if game.rule_proposal and game.rule_proposal['status'] == 'PENDING':
        return 'All seated players must accept the proposed rules before starting.'
    policy = GameTablePolicy.for_game(game.game_type, game.capacity)
    required_phase = 'LOCKED' if policy.requires_explicit_lock else 'OPEN'
    if game.table.phase != required_phase:
        return 'Lock the roster before starting.' if policy.requires_explicit_lock else 'This roster is not open.'
    if not policy.min_players <= len(game.users) <= policy.max_players:
        return 'Wait for enough players to take a seat.'
    if game.game_type == 'flush' and payload.rules_revision != game.flush_rules_revision:
        return 'Flush rules changed. Review the saved rules before starting.'
    return None


def build_initial_engine(host, game, command_id):
    events = []
    if game.game_type == 'callbreak':
        policy = RedealPolicy(weak_hand_enabled=game.settings['weak_hand_enabled'],
                              no_spades_enabled=game.settings['no_spades_enabled'])
        game.state = create_match(GameConfig(game.capacity, redeal_policy=policy),
                                  initial_dealer=host._random.randint(1, game.capacity))
        events = host._apply_controllers(game)
    else:
        if game.game_type == 'marriage':
            adapter = MarriageAdapter(MarriageGameEngine(tuple(str(i + 1) for i in range(len(game.users))),
                rules=MarriageRules(scoring=game.marriage_scoring)), match_id=game.match_id, owner_player_id='1')
            result = adapter.dispatch_player(MarriageCommand(match_id=game.match_id, command_id=command_id,
                expected_revision=0, command='START_GAME'), player_id='1')
            result_type = MarriageResult
            target_type = HostedMarriageTarget
        else:
            seats = tuple(str(game.flush_seats[u]) for u in game.users)
            owner = str(game.flush_seats[game.users[0]])
            adapter = FlushAdapter(FlushGameEngine(seats, rules=game.flush_rules,
                dealer_id=host._random.choice(seats)), match_id=game.match_id, owner_player_id=owner)
            result = adapter.dispatch_player(FlushCommand(match_id=game.match_id, command_id=command_id,
                expected_revision=0, command='START_GAME'), player_id=owner)
            result_type = FlushResult
            target_type = HostedFlushTarget
        if not isinstance(result, result_type):
            raise GameCommandRejected('START_REJECTED', result.detail)
        target = target_type(host, game, adapter)
        if game.game_type == 'marriage':
            game.marriage_target = target
        else:
            game.flush_target = target
            game.flush_queries = {}
        events = [OutgoingEvent(r.message.model_dump(mode='json'),
                  target.user_by_seat[r.recipient_player_id] if r.recipient_player_id else None)
                  for r in result.messages]
    game.play_mode = 'manual'
    # The initial durable game uses the hosted match identity. Later Flush rounds
    # need a separate round identity contract and are not handled by this function.
    game.durable_game_id = UUID(game.match_id)
    game.table.phase = 'STARTED'
    game.table.emit('GAME_STARTED', match_id=game.match_id)
    return events
