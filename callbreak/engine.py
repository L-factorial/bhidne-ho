"""Pure reducer: state + command -> new state + events, or rejection.

Only this module coordinates phase transitions. Randomness, scheduling,
authentication, transport and persistence are supplied by the caller.
"""

from dataclasses import replace

from card_utils import Card, cut, deal as distribute, standard_52

from .commands import AcceptHand, ClaimRedeal, PlaceBid, PlayCard, Redeal, StartDeal
from .commands import PrepareDeal, ShuffleDeck, CompleteShuffle, CutDeck, SkipCut, StartDistribution
from .config import GameConfig, advance
from .deals import CompletedDeal, DealResult, DealState, PlayerDealState
from .events import Event, Transition
from .game import DealPreparation, MatchState, Phase
from .house_rules import redeal_reasons
from .models import Play, Trick
from .rules import PlayRejection, legal_cards, resolve_trick, validate_play
from .scoring import score_deal


def create_match(config: GameConfig | None = None, *, initial_dealer: int = 1) -> MatchState:
    config = config if config is not None else GameConfig()
    if not isinstance(config, GameConfig):
        raise ValueError("A GameConfig is required.")
    if type(initial_dealer) is not int or initial_dealer not in config.players:
        raise ValueError("Dealer must be a player in the match.")
    return MatchState(config=config, initial_dealer=initial_dealer)


def _event(name: str, *, recipient: int | None = None, **data: object) -> Event:
    return Event(name, 0, 0, tuple(data.items()), recipient)


def _finish(state: MatchState, *events: Event) -> Transition:
    updated = replace(state, revision=state.revision + 1)
    return Transition(updated, tuple(replace(e, revision=updated.revision, index=i) for i, e in enumerate(events)))


def _turn(state: MatchState) -> Event:
    return _event("TurnChanged", phase=state.phase.value, player=state.current_player)


def _reject(code: str, detail: str) -> PlayRejection:
    return PlayRejection(code, detail)


def apply_control(state: MatchState, command: StartDeal | Redeal | PrepareDeal | CompleteShuffle) -> Transition | PlayRejection:
    if state.phase == Phase.MATCH_COMPLETE:
        return _reject("MATCH_FINISHED", "The five-deal match has finished.")
    if type(command) is PrepareDeal:
        if state.phase not in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE, Phase.AWAITING_REDEAL):
            return _reject("INVALID_PHASE", "Cannot prepare a deal in this phase.")
        old = state.current_deal
        if state.phase == Phase.AWAITING_REDEAL:
            assert old is not None
            preparation = DealPreparation(old.number, old.attempt + 1, old.dealer)
        else:
            number = len(state.completed_deals) + 1
            preparation = DealPreparation(number, 1, advance(state.initial_dealer, state.config.player_count, number - 1))
        updated = replace(state, current_deal=None, preparation=preparation, phase=Phase.AWAITING_SHUFFLE,
                          abandoned_attempts=state.abandoned_attempts + ((old,) if old else ()))
        return _finish(updated, _event("DealerAssigned", dealer_id=preparation.dealer), _turn(updated))
    if type(command) is CompleteShuffle:
        if state.phase != Phase.SHUFFLING:
            return _reject("INVALID_PHASE", "A dealer must request the shuffle first.")
        if (len(command.deck) != 52 or any(not isinstance(c, Card) for c in command.deck)
                or set(command.deck) != set(standard_52())):
            return _reject("INVALID_DECK", "Supply each of the 52 standard cards exactly once.")
        assert state.preparation is not None
        updated = replace(state, preparation=replace(state.preparation, deck=command.deck), phase=Phase.AWAITING_CUT)
        return _finish(updated, _event("DeckShuffled", dealer_id=state.preparation.dealer), _turn(updated))
    if type(command) not in (StartDeal, Redeal):
        return _reject("UNKNOWN_COMMAND", "Unknown controller command.")
    retry = type(command) is Redeal
    permitted = (Phase.AWAITING_REDEAL,) if retry else (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE)
    if state.phase not in permitted:
        return _reject("INVALID_PHASE", "Cannot distribute cards in this phase.")
    if (len(command.deck) != 52 or any(not isinstance(c, Card) for c in command.deck)
            or set(command.deck) != set(standard_52())):
        return _reject("INVALID_DECK", "Supply each of the 52 standard cards exactly once.")
    old = state.current_deal
    if retry:
        assert old is not None
        number, dealer, attempt = old.number, old.dealer, old.attempt + 1
    else:
        number, attempt = len(state.completed_deals) + 1, 1
        dealer = advance(state.initial_dealer, state.config.player_count, number - 1)
    return _distribute(state, command.deck, number, dealer, attempt, retry, old if retry else None)


def _distribute(state, deck, number, dealer, attempt, retry=False, old=None, individual=False):
    hands, unused = distribute(deck, state.config.player_count, state.config.tricks_per_deal)
    by_player = {
        advance(dealer, state.config.player_count, i + 1): hand
        for i, hand in enumerate(hands)
    }
    current = DealState(number, attempt, dealer,
                        tuple(PlayerDealState(p, by_player[p]) for p in state.config.players), unused)
    phase = Phase.HAND_REVIEW if state.config.redeal_policy.enabled else Phase.BIDDING
    updated = replace(state, phase=phase, current_deal=current, preparation=None,
                      abandoned_attempts=state.abandoned_attempts + ((old,) if retry else ()))
    if individual:
        events = [_event("DistributionStarted", dealer_id=dealer,
                         first_recipient_id=advance(dealer, state.config.player_count),
                         cards_per_player=state.config.tricks_per_deal)]
        for index, card in enumerate(deck[:state.config.player_count * state.config.tricks_per_deal]):
            owner = advance(dealer, state.config.player_count, index + 1)
            data = dict(player_id=owner, hand_count=index // state.config.player_count + 1,
                        distribution_index=index + 1)
            events.append(_event("CardDealt", recipient=owner, card=card, **data))
            events.append(_event("CardDistributed", **data))
        events.append(_event("DistributionCompleted", hand_counts=tuple(len(p.hand) for p in current.players),
                             undealt_count=len(unused)))
    else:
        events = [_event("HandsRedealt" if retry else "DealStarted", deal=number, attempt=attempt,
                         dealer=dealer, first_bidder=advance(dealer, state.config.player_count),
                         hand_counts=tuple(len(p.hand) for p in current.players))]
        for p in current.players:
            events.append(_event("HandDealt", recipient=p.player_id, hand=p.hand,
                                 deal=number, attempt=attempt))
    if phase == Phase.BIDDING:
        events.append(_turn(updated))
    return _finish(updated, *events)


def available_cards(state: MatchState, player_id: int) -> tuple[Card, ...]:
    if type(player_id) is not int or player_id not in state.config.players:
        raise ValueError("Invalid player.")
    if state.phase != Phase.PLAYING:
        return ()
    deal = state.current_deal
    assert deal is not None and deal.current_trick is not None
    return legal_cards(deal.players[player_id - 1].hand, deal.current_trick, player_id)


def apply_player(
    state: MatchState, player_id: int,
    command: PlaceBid | PlayCard | AcceptHand | ClaimRedeal | ShuffleDeck | CutDeck | SkipCut | StartDistribution,
) -> Transition | PlayRejection:
    if type(player_id) is not int or player_id not in state.config.players:
        return _reject("INVALID_PLAYER", "Player is not in this match.")
    if state.phase == Phase.MATCH_COMPLETE:
        return _reject("MATCH_FINISHED", "The five-deal match has finished.")
    if type(command) is StartDistribution:
        if state.phase != Phase.AWAITING_DISTRIBUTION:
            return _reject("INVALID_PHASE", "Wait for the cutter before distributing.")
        if player_id != state.current_player:
            return _reject("NOT_YOUR_TURN", "Only the dealer can distribute.")
        prep = state.preparation
        assert prep is not None
        return _distribute(state, prep.deck, prep.number, prep.dealer, prep.attempt, individual=True)
    if type(command) in (ShuffleDeck, CutDeck, SkipCut):
        expected = Phase.AWAITING_SHUFFLE if type(command) is ShuffleDeck else Phase.AWAITING_CUT
        if state.phase != expected:
            return _reject("INVALID_PHASE", "Preparation command is not allowed in this phase.")
        if player_id != state.current_player:
            return _reject("NOT_YOUR_TURN", "Only the designated player may perform this action.")
        assert state.preparation is not None
        if type(command) is ShuffleDeck:
            updated = replace(state, phase=Phase.SHUFFLING)
            return _finish(updated, _event("ShuffleInitiated", dealer_id=player_id), _turn(updated))
        position = command.position if type(command) is CutDeck else None
        if type(command) is CutDeck and (type(position) is not int or not 1 <= position <= 51):
            return _reject("INVALID_CUT", "Cut position must be an integer from 1 to 51; use SkipCut otherwise.")
        deck = cut(state.preparation.deck, position) if position is not None else state.preparation.deck
        updated = replace(state, phase=Phase.AWAITING_DISTRIBUTION,
                          preparation=replace(state.preparation, deck=deck, cut_position=position))
        return _finish(updated, _event("CutCompleted", cutter_id=player_id,
                                      skipped=position is None, position=position), _turn(updated))
    if type(command) not in (PlaceBid, PlayCard, AcceptHand, ClaimRedeal):
        return _reject("UNKNOWN_COMMAND", "Unknown player command.")
    expected = Phase.BIDDING if type(command) is PlaceBid else Phase.PLAYING if type(command) is PlayCard else Phase.HAND_REVIEW
    if state.phase != expected:
        return _reject("INVALID_PHASE", "Command is not allowed in this phase.")
    deal = state.current_deal
    assert deal is not None
    player = deal.players[player_id - 1]

    if expected == Phase.HAND_REVIEW:
        if player_id in deal.accepted_hands:
            return _reject("HAND_ALREADY_ACCEPTED", "You have already accepted this hand.")
        if type(command) is ClaimRedeal:
            reasons = redeal_reasons(player.hand, state.config.redeal_policy)
            if not reasons:
                return _reject("REDEAL_NOT_ALLOWED", "Your hand does not qualify for a redeal.")
            return _finish(replace(state, phase=Phase.AWAITING_REDEAL),
                           _event("RedealRequested", player=player_id, deal=deal.number, attempt=deal.attempt),
                           _event("RedealEligible", recipient=player_id, reasons=reasons))
        accepted = tuple(sorted((*deal.accepted_hands, player_id)))
        updated = replace(state, current_deal=replace(deal, accepted_hands=accepted))
        events = [_event("HandAccepted", player=player_id)]
        if len(accepted) == state.config.player_count:
            updated = replace(updated, phase=Phase.BIDDING)
            events.append(_turn(updated))
        return _finish(updated, *events)

    if state.current_player != player_id:
        return _reject("NOT_YOUR_TURN", "Wait for your turn.")
    if type(command) is PlaceBid:
        if type(command.amount) is not int or not 1 <= command.amount <= state.config.tricks_per_deal:
            return _reject("INVALID_BID", "Bid must be an integer within the deal's trick count.")
        if player.bid is not None:
            return _reject("ALREADY_BID", "Your bid is already recorded.")
        players = tuple(replace(p, bid=command.amount) if p.player_id == player_id else p for p in deal.players)
        deal = replace(deal, players=players)
        events = [_event("BidPlaced", player=player_id, bid=command.amount)]
        phase = Phase.BIDDING
        if all(p.bid is not None for p in players):
            leader = advance(deal.dealer, state.config.player_count)
            deal = replace(deal, current_trick=Trick(state.config.player_count, leader))
            phase = Phase.PLAYING
            events.append(_event("PlayStarted", leader=leader))
        updated = replace(state, current_deal=deal, phase=phase)
        return _finish(updated, *events, _turn(updated))

    assert deal.current_trick is not None
    error = validate_play(player.hand, deal.current_trick, player_id, command.card)
    if error is not None:
        return error
    players = tuple(replace(p, hand=tuple(c for c in p.hand if c != command.card))
                    if p.player_id == player_id else p for p in deal.players)
    trick = replace(deal.current_trick, plays=deal.current_trick.plays + (Play(player_id, command.card),))
    deal = replace(deal, players=players, current_trick=trick)
    events = [_event("CardPlayed", player=player_id, card=command.card, trick=len(deal.completed_tricks) + 1)]
    if not trick.complete:
        updated = replace(state, current_deal=deal)
        return _finish(updated, *events, _turn(updated))

    winner = resolve_trick(trick)
    deal = replace(deal, current_trick=None, completed_tricks=deal.completed_tricks + (trick,))
    events.append(_event("TrickCompleted", winner=winner, plays=trick.plays,
                         trick=len(deal.completed_tricks), tricks_won=deal.tricks_won))
    if len(deal.completed_tricks) < state.config.tricks_per_deal:
        deal = replace(deal, current_trick=Trick(state.config.player_count, winner))
        updated = replace(state, current_deal=deal)
        return _finish(updated, *events, _turn(updated))

    bids = tuple(p.bid for p in deal.players)
    result = DealResult(bids, deal.tricks_won, score_deal(bids, deal.tricks_won))
    finished = deal.number == state.config.deals_per_match
    updated = replace(state, current_deal=None,
                      completed_deals=state.completed_deals + (CompletedDeal(deal, result),),
                      phase=Phase.MATCH_COMPLETE if finished else Phase.DEAL_COMPLETE)
    events.append(_event("DealCompleted", deal=deal.number, result=result, totals=updated.score_tenths))
    if finished:
        events.append(_event("MatchCompleted", totals=updated.score_tenths, winners=updated.winners))
    return _finish(updated, *events)
