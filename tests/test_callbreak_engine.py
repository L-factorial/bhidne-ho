from dataclasses import replace
from random import Random
import json

import pytest

from card_utils import Card, Rank, Suit, shuffle, standard_52
from callbreak import (
    AcceptHand, ClaimRedeal, GameConfig, Phase, PlaceBid, PlayCard, PlayRejection,
    Redeal, RedealPolicy, StartDeal, Transition, apply_control, apply_player,
    available_cards, create_match, player_view, public_view,
)
from callbreak.audit import audit_deal, audit_match
from callbreak.config import advance
from callbreak.house_rules import redeal_reasons
from callbreak.models import Play, Trick
from callbreak.replay import Entry, Replay
from callbreak.scoring import score_deal
from callbreak.setup import MatchSetup


NO_REVIEW = RedealPolicy(False, Rank.JACK, False)


def accepted(result):
    assert isinstance(result, Transition), result
    assert [e.index for e in result.events] == list(range(len(result.events)))
    assert all(e.revision == result.state.revision for e in result.events)
    return result.state


def begin(n=4, policy=NO_REVIEW, deck=None):
    initial = create_match(GameConfig(n, redeal_policy=policy))
    return accepted(apply_control(initial, StartDeal(deck or standard_52())))


def bid_all(state):
    while state.phase == Phase.BIDDING:
        state = accepted(apply_player(state, state.current_player, PlaceBid(1)))
    return state


@pytest.mark.parametrize("n", [4, 5])
@pytest.mark.parametrize("seed", range(5))
@pytest.mark.parametrize("review", [False, True])
def test_complete_matches_and_deterministic_private_replay(n, seed, review):
    config = GameConfig(n, redeal_policy=RedealPolicy() if review else NO_REVIEW)
    state = create_match(config, initial_dealer=n)
    rng = Random(seed)
    entries = []
    trick_events = 0
    while state.phase != Phase.MATCH_COMPLETE:
        before = state
        if state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE):
            actor, command = None, StartDeal(shuffle(standard_52(), rng=rng))
            result = apply_control(state, command)
        else:
            if state.phase == Phase.HAND_REVIEW:
                actor = next(p for p in config.players if p not in state.current_deal.accepted_hands)
                command = AcceptHand()
            elif state.phase == Phase.BIDDING:
                actor, command = state.current_player, PlaceBid(rng.randrange(config.tricks_per_deal) + 1)
            else:
                actor = state.current_player
                command = PlayCard(rng.choice(available_cards(state, actor)))
            result = apply_player(state, actor, command)
        state = accepted(result)
        entries.append(Entry(actor, command))
        assert state.revision == before.revision + 1
        trick_events += sum(e.name == "TrickCompleted" for e in result.events)
        if state.current_deal:
            d = state.current_deal
            all_cards = [c for p in d.players for c in p.hand] + list(d.undealt_cards)
            all_cards += [p.card for t in d.completed_tricks for p in t.plays]
            if d.current_trick:
                all_cards += [p.card for p in d.current_trick.plays]
            assert len(all_cards) == len(set(all_cards)) == 52
        if state.phase == Phase.DEAL_COMPLETE:
            audit_match(state)
    audit_match(state)
    assert len(state.completed_deals) == 5
    assert trick_events == 5 * config.tricks_per_deal
    assert all(len(d.deal.completed_tricks) == config.tricks_per_deal for d in state.completed_deals)
    assert all(len(t.plays) == n for d in state.completed_deals for t in d.deal.completed_tricks)
    assert state.revision == (285 if n == 4 else 280) + (5 * n if review else 0)
    assert state.winners and all(state.score_tenths[p - 1] == max(state.score_tenths) for p in state.winners)
    assert [d.deal.dealer for d in state.completed_deals] == [advance(n, n, i) for i in range(5)]
    replay = Replay(config, n, tuple(entries))
    assert Replay.loads(replay.dumps()).restore() == state
    assert apply_control(state, StartDeal(standard_52())).code == "MATCH_FINISHED"
    assert apply_player(state, 1, PlayCard(Card.parse("AS"))).code == "MATCH_FINISHED"


def test_invalid_commands_are_atomic_and_phase_checked():
    initial = create_match()
    assert apply_player(initial, 1, PlaceBid(1)).code == "INVALID_PHASE"
    assert apply_control(initial, StartDeal(standard_52()[:-1])).code == "INVALID_DECK"
    assert apply_control(initial, StartDeal(standard_52()[:-1] + (standard_52()[0],))).code == "INVALID_DECK"
    assert apply_player(initial, 1, StartDeal(standard_52())).code == "UNKNOWN_COMMAND"
    assert initial.revision == 0 and initial.current_deal is None
    state = begin()
    for invalid in (True, 0, 14, 1.0, "1"):
        assert apply_player(state, state.current_player, PlaceBid(invalid)).code == "INVALID_BID"
    assert apply_player(state, 1, PlaceBid(1)).code == "NOT_YOUR_TURN"
    assert apply_player(state, True, PlaceBid(1)).code == "INVALID_PLAYER"
    assert state.revision == 1 and all(p.bid is None for p in state.current_deal.players)
    assert apply_control(state, Redeal(standard_52())).code == "INVALID_PHASE"
    playing = bid_all(state)
    assert apply_player(playing, playing.current_player, ClaimRedeal()).code == "INVALID_PHASE"
    assert apply_player(playing, playing.current_player, PlaceBid(1)).code == "INVALID_PHASE"
    mine = playing.current_deal.players[playing.current_player - 1].hand
    absent = next(c for c in standard_52() if c not in mine)
    assert apply_player(playing, playing.current_player, PlayCard(absent)).code == "CARD_NOT_OWNED"


def test_deal_review_and_private_delivery():
    initial = create_match()
    result = apply_control(initial, StartDeal(standard_52()))
    state = accepted(result)
    assert state.phase == Phase.HAND_REVIEW and state.current_player is None
    private = [e for e in result.events if e.recipient is not None]
    assert {e.recipient for e in private} == {1, 2, 3, 4}
    assert all(e.name == "HandDealt" for e in private)
    public = public_view(state)
    assert "hand" not in public and "undealt_cards" not in public
    for p in state.config.players:
        view = player_view(state, p)
        assert view["hand"] == tuple(map(str, state.current_deal.players[p - 1].hand))
        assert view["can_accept_hand"]
        view["rules"]["weak_hand_enabled"] = False
        assert state.config.redeal_policy.weak_hand_enabled
    for p in (4, 2, 1, 3):
        state = accepted(apply_player(state, p, AcceptHand()))
    assert state.phase == Phase.BIDDING and state.current_player == 2
    audit_match(state)


def no_spade_deck(n):
    # Recipient zero is player 2 when dealer is player 1.
    remaining = list(standard_52())
    desired = [c for c in remaining if c.suit != Suit.SPADES][:52 // n]
    for card in desired:
        remaining.remove(card)
    deck = []
    for i in range(52):
        if i < (52 // n) * n and i % n == 0:
            deck.append(desired.pop(0))
        else:
            deck.append(remaining.pop(0))
    return tuple(deck)


@pytest.mark.parametrize("n", [4, 5])
def test_redeal_preserves_deal_and_dealer_and_replays(n):
    config = GameConfig(n)
    state = create_match(config)
    commands = [Entry(None, StartDeal(no_spade_deck(n))), Entry(2, ClaimRedeal()),
                Entry(None, Redeal(shuffle(standard_52(), rng=Random(9))))]
    started = accepted(apply_control(state, commands[0].command))
    assert "NO_SPADES" in player_view(started, 2)["redeal_reasons"]
    waived = accepted(apply_player(started, 2, AcceptHand()))
    assert apply_player(waived, 2, ClaimRedeal()).code == "HAND_ALREADY_ACCEPTED"
    result = apply_player(started, 2, ClaimRedeal())
    waiting = accepted(result)
    assert waiting.phase == Phase.AWAITING_REDEAL
    assert player_view(waiting, 2)["hand"] == ()
    assert "reasons" not in dict(result.events[0].data)
    assert result.events[1].recipient == 2
    assert apply_player(waiting, 3, ClaimRedeal()).code == "INVALID_PHASE"
    assert apply_control(waiting, StartDeal(standard_52())).code == "INVALID_PHASE"
    redone = accepted(apply_control(waiting, commands[2].command))
    assert redone.current_deal.number == 1 and redone.current_deal.dealer == 1
    assert redone.current_deal.attempt == 2 and redone.current_deal.accepted_hands == ()
    assert redone.score_tenths == (0,) * n and redone.completed_deals == ()
    assert redone.abandoned_attempts == (started.current_deal,)
    assert len(redone.current_deal.undealt_cards) == 52 % n
    assert all(not redone.current_deal.void_suits(p) for p in config.players)
    audit_match(redone)
    assert Replay.loads(Replay(config, 1, tuple(commands)).dumps()).restore() == redone


@pytest.mark.parametrize("hand,policy,expected", [
    ("JS 2H", RedealPolicy(), ("WEAK_HAND",)),
    ("QS 2H", RedealPolicy(), ()),
    ("QS 2H", RedealPolicy(weak_hand_threshold=Rank.QUEEN), ("WEAK_HAND",)),
    ("KS 2H", RedealPolicy(weak_hand_threshold=Rank.QUEEN), ()),
    ("AH KH", RedealPolicy(), ("NO_SPADES",)),
    ("JH 2C", RedealPolicy(), ("WEAK_HAND", "NO_SPADES")),
    ("JH 2C", NO_REVIEW, ()),
    ("AH 2C", RedealPolicy(no_spades_enabled=False), ()),
])
def test_house_rule_boundaries(hand, policy, expected):
    assert redeal_reasons(tuple(map(Card.parse, hand.split())), policy) == expected


def test_scores_use_exact_tenths_and_validate_counts():
    assert score_deal((4, 4, 2, 1), (6, 3, 2, 2)) == (42, -40, 20, 11)
    assert score_deal((1, 2, 3, 4, 5), (2, 2, 2, 2, 2)) == (11, 20, -30, -40, -50)
    with pytest.raises(ValueError):
        score_deal((True, 1, 1, 1), (4, 3, 3, 3))
    with pytest.raises(ValueError):
        score_deal((1, 1, 1, 1), (0, 0, 0, 0))


def test_setup_edits_invalidate_agreement_and_freeze_on_start():
    setup = MatchSetup(GameConfig())
    setup = setup.accept(1, expected_revision=0)
    revised = setup.propose(2, GameConfig(redeal_policy=NO_REVIEW), expected_revision=0)
    assert revised.accepted == () and revised.revision == 1
    with pytest.raises(ValueError):
        revised.accept(3, expected_revision=0)
    with pytest.raises(ValueError):
        revised.start(1, expected_revision=1)
    for p in revised.config.players:
        revised = revised.accept(p, expected_revision=1)
    frozen, match = revised.start(1, expected_revision=1)
    assert match.config == revised.config
    with pytest.raises(ValueError):
        frozen.propose(1, GameConfig(), expected_revision=1)
    admin_only = setup.propose(1, setup.config, expected_revision=0, anyone_can_edit=False)
    with pytest.raises(ValueError):
        admin_only.propose(2, setup.config, expected_revision=1)
    with pytest.raises(ValueError):
        setup.accept(5, expected_revision=0)


def test_audit_detects_failure_to_follow_or_beat_in_history():
    state = bid_all(begin())
    deal = state.current_deal
    # Construct a historically illegal pair but preserve every card's ownership.
    leader = deal.current_trick.leader
    follower = advance(leader, 4)
    lead = next(c for c in deal.players[leader - 1].hand if c.suit == Suit.CLUBS)
    follow_hand = deal.players[follower - 1].hand
    wrong = next(c for c in follow_hand if c.suit != Suit.CLUBS)
    players = tuple(replace(p, hand=tuple(c for c in p.hand if c != (lead if p.player_id == leader else wrong)))
                    if p.player_id in (leader, follower) else p for p in deal.players)
    forged = replace(deal, players=players,
                     current_trick=Trick(4, leader, (Play(leader, lead), Play(follower, wrong))))
    assert Suit.CLUBS in forged.void_suits(follower)
    with pytest.raises(ValueError, match="Illegal historical play"):
        audit_deal(forged, state.config)
    # Legal live play is accepted and its historical audit agrees.
    legal = accepted(apply_player(state, leader, PlayCard(lead)))
    audit_match(legal)


def test_replay_rejects_tampering_unknown_version_and_bad_commands():
    replay = Replay(GameConfig(redeal_policy=NO_REVIEW), 1, (Entry(None, StartDeal(standard_52())),))
    data = json.loads(replay.dumps())
    data["version"] = 2
    with pytest.raises(ValueError):
        Replay.loads(json.dumps(data))
    data["version"] = 1
    data["entries"].append({"actor": 1, "command": "PlaceBid", "amount": 1})
    with pytest.raises(ValueError, match="NOT_YOUR_TURN"):
        Replay.loads(json.dumps(data))
    data["entries"][-1] = {"actor": None, "command": "__import__"}
    with pytest.raises(ValueError):
        Replay.loads(json.dumps(data))


def test_audit_catches_earlier_failure_to_beat_with_later_high_card_still_held():
    state = bid_all(begin())
    deal = state.current_deal
    # Ordered standard dealing gives player 2 the 10C and player 3 both 3C/JC.
    lead, low, high = map(Card.parse, ("10C", "3C", "JC"))
    assert lead in deal.players[1].hand
    assert low in deal.players[2].hand and high in deal.players[2].hand
    players = tuple(replace(p, hand=tuple(c for c in p.hand if c != (lead if p.player_id == 2 else low)))
                    if p.player_id in (2, 3) else p for p in deal.players)
    forged = replace(deal, players=players,
                     current_trick=Trick(4, 2, (Play(2, lead), Play(3, low))))
    with pytest.raises(ValueError, match="ILLEGAL_CARD"):
        audit_deal(forged, state.config)


def test_ineligible_claim_and_invalid_configuration():
    state = begin(policy=RedealPolicy())
    assert all(not redeal_reasons(p.hand, state.config.redeal_policy) for p in state.current_deal.players)
    assert apply_player(state, 2, ClaimRedeal()).code == "REDEAL_NOT_ALLOWED"
    assert state.revision == 1
    for n in (True, 3, 6, 4.0):
        with pytest.raises(ValueError):
            GameConfig(n)
    with pytest.raises(ValueError):
        GameConfig(deals_per_match=6)
    with pytest.raises(ValueError):
        RedealPolicy(weak_hand_threshold=Rank.KING)
    with pytest.raises(ValueError):
        RedealPolicy(weak_hand_enabled=1)
