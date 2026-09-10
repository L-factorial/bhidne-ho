"""Audit trusted deal histories by reconstructing hands and replaying plays."""

from card_utils import standard_52

from .config import GameConfig, advance
from .deals import DealState
from .game import MatchState, Phase
from .models import Trick
from .rules import resolve_trick, validate_play
from .scoring import score_deal


def audit_deal(deal: DealState, config: GameConfig) -> None:
    """Raise ValueError on invalid history; never alter a live deal."""
    def require(condition, detail):
        if not condition:
            raise ValueError(detail)

    n = config.player_count
    require(tuple(p.player_id for p in deal.players) == config.players, "Invalid player roster.")
    require(type(deal.number) is int and 1 <= deal.number <= 5, "Invalid deal number.")
    require(type(deal.attempt) is int and deal.attempt >= 1, "Invalid attempt.")
    require(type(deal.dealer) is int and deal.dealer in config.players, "Invalid dealer.")
    require(all(type(p) is int and p in config.players for p in deal.accepted_hands)
            and tuple(sorted(set(deal.accepted_hands))) == deal.accepted_hands, "Invalid hand acceptances.")
    require(len(deal.undealt_cards) == 52 % n, "Invalid undealt pile.")
    require(len(deal.completed_tricks) <= config.tricks_per_deal, "Too many tricks.")
    for player in deal.players:
        require(player.bid is None or type(player.bid) is int and 1 <= player.bid <= config.tricks_per_deal,
                "Invalid bid.")
    order = tuple(advance(deal.dealer, n, i + 1) for i in range(n))
    bids = tuple(deal.players[p - 1].bid for p in order)
    first_missing = next((i for i, b in enumerate(bids) if b is None), n)
    require(all(b is None for b in bids[first_missing:]), "Bidding is out of order.")
    tricks = deal.completed_tricks + ((deal.current_trick,) if deal.current_trick else ())
    if tricks:
        require(first_missing == n, "Trick play before bidding completed.")
    if deal.current_trick:
        require(not deal.current_trick.complete, "Completed trick not archived.")
        require(len(deal.completed_tricks) < config.tricks_per_deal, "Extra trick after final trick.")
    hands = [list(p.hand) for p in deal.players]
    all_cards = list(deal.undealt_cards)
    for trick in tricks:
        require(trick.player_count == n, "Trick player count mismatch.")
        for play in trick.plays:
            hands[play.player_id - 1].append(play.card)
    for hand in hands:
        require(len(hand) == config.tricks_per_deal, "Incorrect reconstructed initial hand size.")
        all_cards.extend(hand)
    require(len(all_cards) == 52 and set(all_cards) == set(standard_52()), "Cards duplicated or missing.")
    leader = advance(deal.dealer, n)
    for index, trick in enumerate(tricks):
        require(trick.leader == leader, "Previous winner must lead.")
        prefix = Trick(n, leader)
        for play in trick.plays:
            hand = hands[play.player_id - 1]
            error = validate_play(hand, prefix, play.player_id, play.card)
            require(error is None, f"Illegal historical play in trick {index + 1}: {error}")
            hand.remove(play.card)
            prefix = Trick(n, leader, prefix.plays + (play,))
        if index < len(deal.completed_tricks):
            require(trick.complete, "Incomplete archived trick.")
            leader = resolve_trick(trick)


def audit_match(state: MatchState) -> None:
    """Structural/history audit; use transcript replay for command provenance."""
    if not isinstance(state.phase, Phase) or type(state.revision) is not int or state.revision < 0:
        raise ValueError("Invalid match metadata.")
    if type(state.initial_dealer) is not int or state.initial_dealer not in state.config.players:
        raise ValueError("Invalid initial dealer.")
    completed = state.completed_deals
    preparing = state.phase in (Phase.AWAITING_SHUFFLE, Phase.SHUFFLING, Phase.AWAITING_CUT, Phase.AWAITING_DISTRIBUTION)
    prep = state.preparation
    if preparing != (prep is not None):
        raise ValueError("Preparation does not agree with phase.")
    if prep:
        if (state.current_deal is not None or type(prep.number) is not int
                or prep.number != len(completed) + 1 or not 1 <= prep.number <= 5
                or type(prep.attempt) is not int or prep.attempt < 1
                or prep.dealer != advance(state.initial_dealer, state.config.player_count, prep.number - 1)):
            raise ValueError("Invalid deal preparation.")
        if state.phase in (Phase.AWAITING_CUT, Phase.AWAITING_DISTRIBUTION):
            if len(prep.deck) != 52 or set(prep.deck) != set(standard_52()):
                raise ValueError("Invalid prepared deck.")
        elif prep.deck:
            raise ValueError("Deck supplied before shuffle completion.")
        if prep.cut_position is not None and (state.phase != Phase.AWAITING_DISTRIBUTION
                or type(prep.cut_position) is not int or not 1 <= prep.cut_position <= 51):
            raise ValueError("Invalid recorded cut.")
    if len(completed) > 5:
        raise ValueError("Too many deals.")
    for number, archived in enumerate(completed, 1):
        deal = archived.deal
        audit_deal(deal, state.config)
        expected_dealer = advance(state.initial_dealer, state.config.player_count, number - 1)
        if deal.number != number or deal.dealer != expected_dealer or deal.current_trick is not None:
            raise ValueError("Invalid archived deal.")
        if len(deal.completed_tricks) != state.config.tricks_per_deal or any(p.hand for p in deal.players):
            raise ValueError("Archived deal is incomplete.")
        bids = tuple(p.bid for p in deal.players)
        if (archived.result.bids != bids or archived.result.tricks_won != deal.tricks_won
                or archived.result.score_tenths != score_deal(bids, deal.tricks_won)):
            raise ValueError("Recorded scores do not agree with history.")
    deal = state.current_deal
    active = state.phase in (Phase.HAND_REVIEW, Phase.AWAITING_REDEAL, Phase.BIDDING, Phase.PLAYING)
    if active != (deal is not None):
        raise ValueError("Phase does not agree with current deal.")
    if deal:
        audit_deal(deal, state.config)
        if deal.number != len(completed) + 1 or deal.dealer != advance(state.initial_dealer, state.config.player_count, deal.number - 1):
            raise ValueError("Incorrect active deal sequence.")
        if state.phase in (Phase.HAND_REVIEW, Phase.AWAITING_REDEAL):
            if not state.config.redeal_policy.enabled or any(p.bid is not None for p in deal.players) or deal.current_trick or deal.completed_tricks:
                raise ValueError("Invalid hand review state.")
        if state.phase in (Phase.BIDDING, Phase.PLAYING) and state.config.redeal_policy.enabled:
            if deal.accepted_hands != state.config.players:
                raise ValueError("Hands not accepted before bidding.")
        if state.phase == Phase.BIDDING and (deal.current_trick or deal.completed_tricks or all(p.bid is not None for p in deal.players)):
            raise ValueError("Invalid bidding state.")
        if state.phase == Phase.PLAYING and deal.current_trick is None:
            raise ValueError("Playing requires a current trick.")
    if state.phase == Phase.MATCH_COMPLETE and len(completed) != 5:
        raise ValueError("Match ended early.")
    if len(completed) == 5 and state.phase != Phase.MATCH_COMPLETE:
        raise ValueError("Fifth deal must end the match.")
    if state.phase == Phase.AWAITING_DEAL and completed:
        raise ValueError("Initial phase cannot contain completed deals.")
    if state.phase == Phase.DEAL_COMPLETE and not 1 <= len(completed) < 5:
        raise ValueError("Invalid deal boundary.")
    for abandoned in state.abandoned_attempts:
        audit_deal(abandoned, state.config)
        if any(p.bid is not None for p in abandoned.players) or abandoned.completed_tricks or abandoned.current_trick:
            raise ValueError("Cannot abandon a deal after bidding.")
