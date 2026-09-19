"""Unanimous seated-player approval around validated, pre-game rule changes."""
from copy import deepcopy
from dataclasses import asdict
from uuid import uuid4

from fastapi import HTTPException
from marriage.scoring_rules import ScoringRules
from flush import FlushRulesConfig
from pydantic import TypeAdapter
import json


class RuleProposals:
    def _sync_proposal(self, game):
        proposal = game.rule_proposal
        if proposal and proposal['status'] == 'PENDING' and (
                game.ended or proposal['voters'] != game.users or game.departed):
            proposal['status'] = 'CANCELLED'
            game.table.emit('RULE_CHANGE_CANCELLED', proposal_id=proposal['id'], reason='Roster changed')

    def _proposal_view(self, game, user_id):
        self._sync_proposal(game)
        if not game.rule_proposal:
            return None
        proposal = deepcopy(game.rule_proposal)
        proposal['can_vote'] = (proposal['status'] == 'PENDING' and user_id in proposal['voters']
                                and user_id not in proposal['accepted'])
        proposal['proposer_name'] = self.profiles.name(proposal['proposer'], 1) if self.profiles else 'Creator'
        return proposal

    def _apply_proposal(self, game):
        proposal = game.rule_proposal
        settings = proposal['proposed']
        if game.game_type == 'callbreak':
            game.settings = deepcopy(settings)
        elif game.game_type == 'marriage':
            game.marriage_scoring = ScoringRules.from_dict(settings)
        else:
            game.flush_rules = TypeAdapter(FlushRulesConfig).validate_json(json.dumps(settings['rules']), strict=True)
            game.flush_rules_revision += 1
        proposal['status'] = 'ACCEPTED'
        game.table.emit('RULE_CHANGE_ACCEPTED', proposal_id=proposal['id'])

    def _propose(self, game, user_id, proposed):
        self._sync_proposal(game)
        if game.rule_proposal and game.rule_proposal['status'] == 'PENDING':
            raise HTTPException(409, 'Resolve the pending rule proposal before submitting another.')
        current = (game.settings if game.game_type == 'callbreak' else asdict(game.marriage_scoring)
                   if game.game_type == 'marriage' else {'rules': asdict(game.flush_rules)})
        game.rule_proposal = {'id': uuid4().hex, 'match_id': game.match_id, 'proposer': user_id,
                              'status': 'PENDING', 'voters': list(game.users), 'accepted': [user_id],
                              'rejected_by': None, 'previous': deepcopy(current), 'proposed': deepcopy(proposed)}
        game.table.emit('RULE_CHANGE_PROPOSED', proposal_id=game.rule_proposal['id'])
        # With only the creator seated, their submission is unanimous approval.
        if len(game.users) == 1:
            self._apply_proposal(game)

    async def vote_rules(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id, body.match_id)
        async with game.lock:
            await self._member(room_id, user_id, game)
            self._sync_proposal(game)
            proposal = game.rule_proposal
            if body.match_id != game.match_id or not proposal or body.proposal_id != proposal['id']:
                raise HTTPException(409, 'This rule proposal is no longer current.')
            if user_id not in proposal['voters'] or user_id not in game.users or user_id in game.departed:
                raise HTTPException(403, 'Only seated players may vote on rules.')
            if proposal['status'] != 'PENDING':
                if (body.accept and user_id in proposal['accepted'] and proposal['status'] == 'ACCEPTED') or (
                        not body.accept and proposal['rejected_by'] == user_id):
                    return self._snapshot(game, user_id)
                raise HTTPException(409, 'This rule proposal has already been resolved.')
            if user_id in proposal['accepted']:
                if body.accept:
                    return self._snapshot(game, user_id)
                raise HTTPException(409, 'Your vote has already been recorded.')
            if not body.accept:
                proposal['status'] = 'REJECTED'
                proposal['rejected_by'] = user_id
                game.table.emit('RULE_CHANGE_REJECTED', proposal_id=proposal['id'], user_id=user_id)
            else:
                proposal['accepted'].append(user_id)
                if set(proposal['accepted']) == set(proposal['voters']):
                    self._apply_proposal(game)
            await self._publish(game)
            return self._snapshot(game, user_id)
