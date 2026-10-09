"""Authoritative session policy. Clocks and connection evidence are supplied by callers.

Engine seats and financial identities are historical. Call Break handover changes
only their temporary controller; decisions receive an allowlisted own-player view.
"""
from copy import deepcopy
from random import SystemRandom

from callbreak import GameQuery
from app.models.action import ActionCommand

IDLE_SECONDS = 30 * 60
ACTION_SECONDS = 3 * 60
CALLBREAK_SECONDS = 2 * 60
OFFER_SECONDS = 60
AUTO_SECONDS = 2


def controller(game, seat):
    original = game.users[seat - 1]
    entry = game.session.get('controls', {}).get(str(seat))
    return entry['user_id'] if entry else original


def player_seat(game, user):
    if user in game.departed or game.ended:
        return None
    return next((i for i in range(1, len(game.users) + 1) if controller(game, i) == user), None)


def between_games(game):
    return not game.started or game.finished or game.flush_open


def required(game):
    if game.ended or between_games(game):
        return {}
    if game.game_type == 'callbreak':
        query = GameQuery(game.state)
        view = query.get_state()
        phase = view['phase']
        turn = query.get_turn()
        players = turn['pending_players']
        if phase == 'DEAL_COMPLETE':
            players = [1]
        trick = view['current_trick']
        token = f"{phase}:{view['deal_number']}:{game.state.current_deal.attempt if game.state.current_deal else 0}:{trick['trick_number'] if trick else 0}"
        return {str(p): token for p in players if p is not None}
    public = (game.marriage_target or game.flush_target).adapter.snapshot()['view']
    token = f"{public['status']}:{public.get('phase')}:{public.get('round_number', 0)}"
    if public.get('tunnela_declaration_pending'):
        return {p['player_id']: token for p in public['players'] if not p['folded'] and not p['tunnela_declared']}
    seat = public.get('current_player_id')
    if game.game_type == 'flush':
        side = public.get('pending_side_show')
        show = public.get('pending_show')
        if side:
            seat = side['requester_id'] if side['accepted'] else side['target_id']
            token += f":side:{side['requester_id']}:{side['target_id']}:{side['accepted']}"
        elif show:
            seat = show['target_id']
            token += f":show:{show['requester_id']}:{show['target_id']}"
    return {str(seat): token} if seat else {}


def sync(game, now, *, actor=None, activity=False):
    """Run before committing accepted effects. Polls/rejections never call activity.

    Start the between-game deadline at completion, never at the last game action.
    Preserve each simultaneous review deadline when another player acts.
    """
    session = game.session
    if not session:
        session.update(version=1, last_activity=now, idle_deadline=None, turns={}, controls={}, removed={}, expired_at=None)
    session['updated_at'] = now
    if activity:
        session['last_activity'] = now
        if actor in game.table.seats(game):
            session['removed'].pop(actor, None)
    if game.ended:
        session['idle_deadline'] = None
        session['turns'] = {}
        for c in session['controls'].values():
            c.update(offer=None, disconnected_at=None, return_pending=False)
        return
    idle = between_games(game)
    if idle:
        if session['idle_deadline'] is None or activity:
            session['idle_deadline'] = now + IDLE_SECONDS
    else:
        session['idle_deadline'] = None
    if game.game_type == 'callbreak' and game.started:
        for seat, user in enumerate(game.users, 1):
            session['controls'].setdefault(str(seat), dict(user_id=user, mode='manual', last_active_at=now, disconnected_at=None,
                offer=None, declined=[], return_pending=False))
        if activity and actor:
            for c in session['controls'].values():
                if c['user_id'] == actor:
                    c.update(last_active_at=now, disconnected_at=None, offer=None)
        apply_returns(game)
        if game.finished:
            for seat,c in session['controls'].items():
                c.update(offer=None, disconnected_at=None, return_pending=False,
                    mode='manual' if c['user_id'] == game.users[int(seat)-1] else 'replacement')
    actors = required(game)
    previous = session['turns']
    turns = {}
    for seat, token in actors.items():
        control = session['controls'].get(seat)
        user = controller(game, int(seat)) if control else next((u for u, s in game.flush_seats.items() if str(s) == seat), None) if game.game_type == 'flush' else game.users[int(seat) - 1]
        old = previous.get(seat)
        # A valid action by this seat renews its requirement (draw -> discard,
        # seen -> bet); other players cannot extend it with out-of-turn commands.
        if old and old['token'] == token and old['user_id'] == user and actor != user:
            turns[seat] = old
        else:
            timeout = AUTO_SECONDS if control and control['mode'] == 'auto' else CALLBREAK_SECONDS if game.game_type == 'callbreak' else ACTION_SECONDS
            turns[seat] = dict(token=token, user_id=user, deadline=now + timeout)
    session['turns'] = turns


def safe_boundary(game):
    if game.game_type != 'callbreak' or not game.state:
        return True
    trick = GameQuery(game.state).get_current_trick()
    return not trick or not trick['plays']


def apply_returns(game):
    if not safe_boundary(game):
        return
    for seat, entry in game.session.get('controls', {}).items():
        if entry['return_pending']:
            entry.update(user_id=game.users[int(seat)-1], mode='manual', disconnected_at=None,
                offer=None, declined=[], return_pending=False)
            game.table.emit('SEAT_RECLAIMED', seat_id=int(seat), user_id=entry['user_id'], match_id=game.match_id)


def live_control(game, actor, command, now):
    """Caller checks authenticated membership, reservation, match/table revision."""
    if game.game_type != 'callbreak' or not game.started or game.finished or game.ended:
        return 'Live seat control is available only during Call Break.'
    if command == 'pause-seat':
        seat = player_seat(game, actor)
        if seat is None:
            return 'You do not control a seat in this game.'
        entry = game.session['controls'][str(seat)]
        if entry['mode'] == 'auto':
            return 'This seat is already using Auto play.'
        entry.update(mode='auto', disconnected_at=None, offer=None)
        game.table.emit('PLAYER_AUTO_PLAY', seat_id=seat, user_id=actor, reason='PLAYER_AWAY')
        sync(game, now, actor=actor, activity=True)
        return None
    if command == 'reclaim-seat':
        if actor in game.users:
            seat = str(game.users.index(actor)+1)
        else:
            seat = next((k for k,c in game.session['controls'].items() if c['user_id'] == actor and c['mode'] == 'auto' and not c['return_pending']), None)
            if seat is None:
                return 'Only the original participant or current controller can resume this seat.'
        entry = game.session['controls'][seat]
        if entry['user_id'] == actor:
            if entry['mode'] == 'manual':
                return 'You already control this seat.'
            entry.update(mode='manual' if actor == game.users[int(seat)-1] else 'replacement',
                disconnected_at=None, offer=None, declined=[], return_pending=False)
        else:
            entry['last_active_at'] = now
            entry['return_pending'] = True
            game.table.emit('SEAT_RETURN_REQUESTED', seat_id=int(seat), user_id=actor, match_id=game.match_id)
            apply_returns(game)
        sync(game, now, actor=actor, activity=True)
        return None
    if actor in game.table.seats(game) or actor in game.users:
        return 'You already hold a seat in this game.'
    found = next(((seat, c) for seat, c in game.session['controls'].items()
        if c['offer'] and c['offer']['user_id'] == actor and c['offer']['deadline'] > now), None)
    if found is None:
        return 'The replacement offer has expired. Refresh the table.'
    seat, entry = found
    if entry['return_pending']:
        return 'The original player is returning.'
    if command == 'decline-live-seat':
        entry['declined'].append(actor)
        entry['offer'] = None
    else:
        entry.update(user_id=actor, mode='replacement', disconnected_at=None, offer=None, declined=[], return_pending=False)
        if actor in game.table.queue:
            game.table.queue.remove(actor)
        game.table.emit('SEAT_HANDED_OVER', seat_id=int(seat), user_id=actor,
            original_user_id=game.users[int(seat)-1], match_id=game.match_id)
    sync(game, now, actor=actor, activity=True)
    return None


def resolve_pending_flush(game):
    """Fold a timed-out dealer once preparation has produced a dealt hand."""
    events = []
    if not game.flush_target:
        return events
    for actor, reason in list(game.session.get('removed', {}).items()):
        if reason != 'TIMEOUT_PENDING_DEAL':
            continue
        target = game.flush_target
        status = target.adapter.snapshot()['view']['status']
        if status not in ('in_progress', 'finished'):
            continue
        if status == 'in_progress':
            request = ActionCommand(match_id=game.match_id, expected_revision=target.revision,
                command_id=f'pending_{game.match_id}_{target.revision}', command='FOLD_FOR_LEAVE')
            events.extend(target.apply(actor, request))
        if actor in game.users:
            game.users.remove(actor)
        game.pending_flush_departures.discard(actor)
        game.session['removed'][actor] = 'ACTION_TIMEOUT'
        game.table.emit('PLAYER_TIMED_OUT', user_id=actor, seat_id=game.flush_seats[actor], reason='ACTION_TIMEOUT')
    return events


def next_due(game):
    s = game.session
    values = [s.get('idle_deadline')]
    values += [t['deadline'] for t in s.get('turns', {}).values()]
    for c in (() if between_games(game) else s.get('controls', {}).values()):
        if c['disconnected_at'] is not None and c['mode'] != 'auto':
            values.append(c['disconnected_at'] + CALLBREAK_SECONDS)
        if c['offer']:
            values.append(c['offer']['deadline'])
    return min((v for v in values if v is not None), default=None)


def random_action(action, *, legal_cards=(), positions=(), bid_min=1, bid_max=13, random=None):
    """No authoritative state, opponent cards, winners or scores enter this decision."""
    rng = random or SystemRandom()
    if action == 'PLAY_CARD':
        return action, {'card': rng.choice(tuple(legal_cards))}
    if action == 'PLACE_BID':
        return action, {'amount': rng.randint(bid_min, bid_max)}
    if action == 'PICK_DEALER_CARD':
        return action, {'position': rng.choice(tuple(positions))}
    if action == 'CUT_OR_SKIP':
        return 'CUT_DECK', {'position': rng.randint(1, 51)}
    if action == 'REVIEW_HAND':
        return 'ACCEPT_HAND', {}
    return action, {}


def tick(host, game, now, *, connections=None, candidates=()):
    """One serialized timer effect. Unknown presence cannot trigger a handover.

    connections maps a user to None (unknown), True (live), or the trusted time
    all their recorded connection leases expired/disconnected. Redis is unused.
    """
    before = deepcopy(game.session)
    sync(game, now)
    events = []
    s = game.session
    if game.ended:
        return events, before != s
    if s['idle_deadline'] is not None and now >= s['idle_deadline']:
        game.ended = True
        s['expired_at'] = now
        game.table.queue.clear()
        game.pending_flush_departures.clear()
        for offer in game.table.pending():
            offer.status = 'CANCELLED'
        game.table.phase = 'ENDED'
        game.table.emit('TABLE_EXPIRED', match_id=game.match_id, reason='INACTIVITY', expired_at=now)
        sync(game, now)
        return events, True
    if game.game_type == 'callbreak' and not between_games(game):
        seated = game.table.seats(game)
        reserved = {c['offer']['user_id'] for c in s['controls'].values() if c['offer']}
        for seat, c in s['controls'].items():
            evidence = (connections or {}).get(c['user_id'])
            if evidence is not None and evidence is not True and evidence < c['last_active_at']:
                evidence = None  # An old socket closed before this player's latest activity.
            if evidence is True:
                c['disconnected_at'] = None
                # Reconnect reserves the original participant against new offers;
                # an existing replacement requires an explicit safe-boundary reclaim.
                if c['user_id'] == game.users[int(seat)-1] and c['offer']:
                    c['offer'] = None
            elif evidence is not None and evidence is not False:
                c['disconnected_at'] = c['disconnected_at'] if c['disconnected_at'] is not None else evidence
            if c['offer'] and now >= c['offer']['deadline']:
                c['declined'].append(c['offer']['user_id'])
                c['offer'] = None
            if c['disconnected_at'] is not None and now >= c['disconnected_at'] + CALLBREAK_SECONDS:
                if c['mode'] != 'auto':
                    c['mode'] = 'auto'
                    game.table.emit('PLAYER_AUTO_PLAY', seat_id=int(seat), user_id=c['user_id'], reason='DISCONNECTED')
                if not c['offer'] and not c['return_pending']:
                    eligible = next((u for u in candidates if u not in seated and u not in game.users
                        and u not in reserved and u not in c['declined']), None)
                    if eligible:
                        c['offer'] = dict(user_id=eligible, deadline=now + OFFER_SECONDS)
                        reserved.add(eligible)
                        game.table.emit('LIVE_SEAT_OFFERED', seat_id=int(seat), user_id=eligible,
                            expires_at=now + OFFER_SECONDS, match_id=game.match_id)
    for seat, turn in list(s['turns'].items()):
        if now < turn['deadline']:
            continue
        actor = turn['user_id']
        if game.game_type == 'callbreak':
            c = s['controls'][seat]
            if c['mode'] != 'auto':
                c['mode'] = 'auto'
                game.table.emit('PLAYER_AUTO_PLAY', seat_id=int(seat), user_id=actor, reason='ACTION_TIMEOUT')
            query = GameQuery(game.state)
            if game.state.phase.value == 'DEAL_COMPLETE':
                events.extend(host._apply_controllers(game, advance_deal=True))
            else:
                action = query.get_turn()['action']
                private = query.get_player_view(int(seat))
                rules = query.get_rules()
                selection = query.get_state()['dealer_selection']
                command, payload = random_action(action, legal_cards=private['legal_cards'],
                    positions=selection['available_positions'] if selection else (),
                    bid_min=rules['bid_min'], bid_max=rules['bid_max'])
                events.extend(host._apply_player(game, int(seat), command, payload,
                    command_id=f'session_{game.match_id}_{game.state.revision}_{seat}'))
                events.extend(host._apply_controllers(game))
        else:
            target = game.marriage_target or game.flush_target
            request = ActionCommand(match_id=game.match_id, expected_revision=target.revision,
                command_id=f'session_{game.match_id}_{target.revision}_{seat}',
                command='FOLD' if game.marriage_target else 'FOLD_FOR_LEAVE')
            # Flush preparation has no dealt hand to fold. Complete the required
            # engine step, then fold before any betting action is possible.
            status = target.adapter.snapshot()['view']['status']
            if game.flush_target and status in ('awaiting_deal', 'awaiting_cut'):
                preparation = 'DEAL_CARDS' if status == 'awaiting_deal' else 'SKIP_CUT'
                events.extend(target.apply(actor, request.model_copy(update={'command': preparation})))
                request = request.model_copy(update={'expected_revision': target.revision})
                # Dealing first requests the cut. Keep this deadline until cards
                # actually exist, even when the cutter is a different participant.
                if target.adapter.snapshot()['view']['status'] != 'in_progress':
                    s['removed'][actor] = 'TIMEOUT_PENDING_DEAL'
                    sync(game, now, actor=actor)
                    return events, True
            events.extend(resolve_pending_flush(game))
            if game.flush_target and target.adapter.snapshot()['view'].get('pending_show'):
                request = request.model_copy(update={'command': 'FOLD'})
            if target.adapter.snapshot()['view']['status'] != 'finished':
                events.extend(target.apply(actor, request.model_copy(update={'expected_revision': target.revision})))
            if game.marriage_target:
                game.departed.add(actor)
            else:
                if actor in game.users:
                    game.users.remove(actor)
                game.pending_flush_departures.discard(actor)
            s['removed'][actor] = 'ACTION_TIMEOUT'
            game.table.emit('PLAYER_TIMED_OUT', user_id=actor, seat_id=int(seat), reason='ACTION_TIMEOUT')
        # At most one engine transition per tick; next tick reloads new authority.
        sync(game, now, actor=actor)
        game.table.sync(game)
        return events, True
    sync(game, now)
    return events, before != s


def view(game, user, now):
    s = game.session
    controls = []
    offer = None
    reclaim = None
    for seat, c in s.get('controls', {}).items():
        original = game.users[int(seat)-1]
        controls.append(dict(seat_id=int(seat), user_id=c['user_id'], original_user_id=original,
            mode=c['mode'], return_pending=c['return_pending'], disconnected_at=c['disconnected_at']))
        if not game.ended and not between_games(game) and c['offer'] and c['offer']['user_id'] == user:
            offer = dict(seat_id=int(seat), expires_at=c['offer']['deadline'])
        if not game.ended and not between_games(game) and ((original == user and (c['mode'] == 'auto' or c['user_id'] != user))
            or (c['user_id'] == user and c['mode'] == 'auto' and not c['return_pending'])):
            reclaim = dict(seat_id=int(seat), pending=c['return_pending'])
    return dict(server_now=s.get('updated_at', s.get('last_activity')), idle_deadline=s.get('idle_deadline'),
        required_actions=[dict(seat_id=int(seat), **{k:v for k,v in t.items() if k != 'token'}) for seat,t in s.get('turns', {}).items()],
        controls=controls, replacement_offer=offer, reclaim=reclaim,
        removal_reason=s.get('removed', {}).get(user), expired_at=s.get('expired_at'))
