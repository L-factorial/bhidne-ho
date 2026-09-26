"""Detached rule proposals and votes; caller holds the durable table transaction."""
from copy import deepcopy
from dataclasses import asdict, fields
import json
from uuid import NAMESPACE_URL, uuid5

from pydantic import TypeAdapter, ValidationError
from flush import FlushRulesConfig
from flush.errors import FlushError
from marriage.scoring_rules import ScoringRules
from app.multiplayer.rule_proposals import RuleProposals
from app.test_games.http import GameSettings, MarriageSettings, FlushSettings, RuleVote

COMMANDS = frozenset({'settings', 'marriage-settings', 'flush-settings', 'rule-vote'})


def apply_rules(game, actor, request, lane_id):
    try:
        model = {'settings': GameSettings, 'marriage-settings': MarriageSettings,
                 'flush-settings': FlushSettings, 'rule-vote': RuleVote}[request.command]
        if 'match_id' in request.payload:
            return 'Match identity belongs in the command envelope.'
        body = model.model_validate({'match_id': request.match_id, **request.payload})
        if body.match_id != game.match_id:
            return 'This match is no longer current.'
        if request.command == 'rule-vote':
            return vote(game, actor, body)
        if not game.users or actor != game.users[0]:
            return 'Only the game creator can propose rules.'
        if game.started or game.ended:
            return 'Settings are only available before the game begins.'
        expected_kind = {'settings': 'callbreak', 'marriage-settings': 'marriage', 'flush-settings': 'flush'}[request.command]
        if game.game_type != expected_kind:
            return 'Settings do not match this game type.'
        if game.rule_proposal and game.rule_proposal['status'] == 'PENDING':
            return 'Resolve the pending rule proposal first.'
        if game.game_type == 'callbreak':
            current, proposed = game.settings, body.model_dump(exclude={'match_id'})
        elif game.game_type == 'marriage':
            current = asdict(game.marriage_scoring)
            proposed = asdict(ScoringRules.from_dict(body.scoring))
        else:
            if body.rules_revision != game.flush_rules_revision:
                return 'Flush rules changed. Reload them before saving.'
            if set(body.rules) != {f.name for f in fields(FlushRulesConfig)}:
                return 'Supply the complete Flush ruleset.'
            rules = TypeAdapter(FlushRulesConfig).validate_json(json.dumps(body.rules), strict=True)
            if rules.minimum_players != 2 or rules.maximum_players != 10:
                return 'Flush tables require limits of 2 to 10 players.'
            current, proposed = {'rules': asdict(game.flush_rules)}, {'rules': asdict(rules)}
        identity = json.dumps([str(lane_id), actor, request.command_id], separators=(',', ':'))
        game.rule_proposal = dict(id=uuid5(NAMESPACE_URL, 'bhidne-ho:rules:'+identity).hex,
            match_id=game.match_id, proposer=actor, status='PENDING', voters=list(game.users),
            accepted=[actor], rejected_by=None, previous=deepcopy(current), proposed=deepcopy(proposed))
        game.table.emit('RULE_CHANGE_PROPOSED', proposal_id=game.rule_proposal['id'])
        if len(game.users) == 1:
            RuleProposals._apply_proposal(None, game)
    except (ValidationError, ValueError, TypeError, KeyError, FlushError):
        return 'Invalid settings or vote payload.'
    return None


def vote(game, actor, body):
    proposal = game.rule_proposal
    if not proposal or body.proposal_id != proposal['id']:
        return 'This rule proposal is no longer current.'
    if actor not in proposal['voters'] or actor not in game.users or actor in game.departed:
        return 'Only seated players may vote.'
    if proposal['status'] != 'PENDING':
        if (body.accept and actor in proposal['accepted'] and proposal['status'] == 'ACCEPTED') or (
                not body.accept and proposal['rejected_by'] == actor):
            return None
        return 'This proposal has already been resolved.'
    if actor in proposal['accepted']:
        return None if body.accept else 'Your vote has already been recorded.'
    if not body.accept:
        proposal['status'], proposal['rejected_by'] = 'REJECTED', actor
        game.table.emit('RULE_CHANGE_REJECTED', proposal_id=proposal['id'], user_id=actor)
    else:
        proposal['accepted'].append(actor)
        if set(proposal['accepted']) == set(proposal['voters']):
            RuleProposals._apply_proposal(None, game)
    return None
