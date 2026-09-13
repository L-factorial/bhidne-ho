# Playing loop, commands, events and player identities

This guide describes the implemented standalone engine. Start with
[the implementation guide](callbreak.md) for rules, query methods and setup.
Run `python -m callbreak --players 4` or `--players 5` to see a full simulation.

## The units of play

| Unit | Meaning | Python model |
| --- | --- | --- |
| Game / match | Exactly five scored deals | `MatchState` in `callbreak/game.py` |
| Deal | Distribution, hand review, bidding, tricks and scoring | `DealState` in `callbreak/deals.py` |
| Trick | One accepted card play from every player, with one winner | `Trick` in `callbreak/models.py` |
| Play | One player's accepted card | `Play` in `callbreak/models.py` |
| Hand | Cards currently held by one player | `PlayerDealState.hand` in `callbreak/deals.py` |
| Bid / quote | Predicted tricks won in this deal | `PlayerDealState.bid` |

Four players means 13 tricks per deal, four plays per trick. Five players means
10 tricks per deal, five plays per trick, with two cards hidden and unused.
“Winning a hand” in casual speech is a trick win in the API: `tricks_won`.
The trick winner leads the next trick. A redeal replaces a distribution attempt,
not one of the five scored deals.

## Player IDs and turn order

The core uses integer player IDs `1, 2, 3, 4` or `1, 2, 3, 4, 5`.
These are fixed seats for the entire match. They contain no username, account ID,
socket or room information. IDs restart at 1 for each independent match.

Turn order increases and wraps back to 1. For five players, if player 4 leads,
the trick order is `4 → 5 → 1 → 2 → 3`. The initial dealer is supplied to
`create_match`; dealer rotates by one each deal. The player after dealer bids
first and leads the first trick. Later tricks start with the preceding winner.

`MatchState.current_player` is derived from the accepted bids or current trick.
There is no duplicated mutable current-player field on each model. It is None
during review, when waiting for a controller, and after match completion.

The future multiplayer adapter owns a roster such as:

```python
# Illustration only: this mapping is not implemented by the core.
player_to_user = {1: "user-alice", 2: "user-bob", 3: "user-carol", 4: "user-david"}
user_to_player = {user: player for player, user in player_to_user.items()}
```

The adapter authenticates the incoming user, looks up their player ID, and passes
that ID to the engine. A client-supplied ID is not identity authority. The reverse
mapping delivers private events to the player in the correct room. Multiple tabs
belonging to one person remain one player. Disconnecting must not erase or reassign
that player's hand. No adapter or automatic seating is currently wired into the
running server; the standalone simulation supplies IDs directly.

## Commands enter; events leave

```text
Current MatchState + actor + command
                ↓
     apply_player / apply_control
                ↓
        Validate before changing anything
          ├── Reject → PlayRejection; old state unchanged
          └── Accept → Transition(new_state, ordered_events)
```

A command requests an action. An event describes an accepted outcome. Do not feed
output events back into the engine to apply the move again: `result.state` already
contains the whole transition. One successful command increases revision by one,
even when it emits several events. A rejected command does not increase revision.

| Caller | Command | Allowed phase | Main processing |
| --- | --- | --- | --- |
| Controller | `StartDeal(deck)` | AWAITING_DEAL / DEAL_COMPLETE | Validate 52 cards, distribute, enter review or bidding |
| Player | `AcceptHand()` | HAND_REVIEW | Record acceptance; last acceptance opens bidding |
| Player | `ClaimRedeal()` | HAND_REVIEW | Check that player's actual hand against agreed policy |
| Controller | `Redeal(deck)` | AWAITING_REDEAL | Replace all hands, retain deal number/dealer/scores |
| Current player | `PlaceBid(amount)` | BIDDING | Validate bid and record it; last bid starts trick 1 |
| Current player | `PlayCard(card)` | PLAYING | Validate and record play; resolve completed trick/deal/match |

Control commands are rejected by the player entry point. The host/controller is
responsible for deck preparation and scheduling, including starting each next
deal. With both redeal rules disabled, distribution goes directly to BIDDING.

## What runs for a card play

```text
apply_player(state, player_id, PlayCard(card))       engine.py
  → check player, command, phase and whose turn
  → validate_play(hand, trick, player_id, card)     rules.py
      → check card ownership
      → legal_cards(...) checks follow/beat/trump rules
  → construct new hand and append Play to new Trick
  → if fewer than N plays: emit CardPlayed, TurnChanged
  → otherwise resolve_trick(trick)                 rules.py
      → archive completed trick, derive tricks_won
      → if cards remain: next Trick led by winner
      → otherwise score_deal(bids, tricks_won)     scoring.py
          → archive CompletedDeal
          → DEAL_COMPLETE or MATCH_COMPLETE
  → _finish(...) assigns revision and event indexes
  → return Transition
```

No method mutates the previous state. Illegal actions never become Play records.
The engine sees authoritative hands, so it immediately rejects a player who
fails to follow suit or beat when able. `audit_deal` can reconstruct and check
historical hands later; a higher card appearing later is only a violation when
the earlier trick's exact context required playing it.

Typical event batches:

| Accepted command | Ordered events |
| --- | --- |
| Ordinary bid | BidPlaced, TurnChanged |
| Final bid | BidPlaced, PlayStarted, TurnChanged |
| First N−1 plays | CardPlayed, TurnChanged |
| Nth play in an ordinary trick | CardPlayed, TrickCompleted, TurnChanged |
| Last play of deals 1–4 | CardPlayed, TrickCompleted, DealCompleted |
| Last play of deal 5 | CardPlayed, TrickCompleted, DealCompleted, MatchCompleted |

Review and distribution additionally emit HandAccepted, DealStarted/HandsRedealt,
private HandDealt, and RedealRequested with private eligibility details.
Events use `recipient=None` for public output and a player ID for private output.
Full state, decks, abandoned hands and replay records must not be broadcast.

## Application loop

The following integration sketch uses application-provided receive/delivery
functions; it is not a transport implementation. The executable version is
[`callbreak/__main__.py`](../callbreak/__main__.py), which generates local commands.

```python
from callbreak import (
    GameConfig, GameQuery, Phase, Transition,
    apply_control, apply_player, create_match,
)

state = create_match(GameConfig(player_count=4), initial_dealer=1)

while state.phase != Phase.MATCH_COMPLETE:
    # The application determines actor from authentication or a trusted local source.
    # actor=None is reserved for the application's controller, never client input.
    actor, command = receive_command()
    result = (
        apply_control(state, command)
        if actor is None
        else apply_player(state, actor, command)
    )

    if not isinstance(result, Transition):
        report_rejection(actor, result.code, result.detail)
        continue

    state = result.state
    for event in result.events:
        deliver_event(event)  # Honor recipient; delivery does not apply state again.

    query = GameQuery(state)
    refresh_public_display(query.get_state(), query.get_deal_table())
```

A server need not literally block inside a while loop: each WebSocket message
handler can perform one iteration against its stored match state. Serialize
commands for a given match so two handlers cannot both update the same old
revision. Keep control authorization, retry deduplication and private delivery in
the host. Delivery failure does not roll back an accepted card play; recover with
a fresh authorized query/snapshot. These networking behaviors remain integration
work, not features supplied by this sample loop.

## Reading state after a move

```python
query = GameQuery(result.state)
query.get_turn()                  # Current player/action, or review/control wait
query.get_current_trick()         # Cards played, led suit, winner so far
query.get_bids()                  # Current deal's player/bid rows
query.get_deal_table()            # Bid, tricks won, cards left, finalized score
query.get_scoreboard()            # Five deal columns plus totals
query.get_rules()                 # Frozen game and house rules
query.get_trick(1, deal_number=1)  # Historical completed trick
```

A query binds to a single immutable revision; create a new one after retaining
`result.state`. `get_player_view(player_id)` adds that authorized player's hand
and legal cards. General queries do not expose private cards. At a deal boundary,
the default deal query shows the latest completed deal; `get_current_trick()` is
None until the next deal's bidding completes. Unscored deal scores are None,
not zero. Full method contracts are in the [query API guide](callbreak.md#public-query-api).

## Implemented and remaining

Implemented: standalone match/deal/trick engine, rules, scoring, redeals, local
settings agreement, queries, private projections, card operations, audit, replay
and deterministic simulations. All core state is in memory; callers may store
private versioned replay records using their own persistence.

Remaining: actual user-to-player roster, platform adapter, room-scoped private
WebSocket delivery, browser gameplay/setup UI, durable service storage and
network retry/disconnect policies. The existing console still uses EchoGameEngine.


## Live round flow and score review

The live client guides players through Shuffle, Cut, Deal, Bid, Play, and Scores.
The current task names the acting player, highlights the local player's turn,
and explains what to do. Cutting offers a midpoint cut (`CUT_DECK`, position 26)
or Skip cut. Legal-card enforcement remains authoritative in the engine.

A newly completed trick stays visible for approximately 2.2 seconds, with the
winner's card highlighted. Repeated snapshots do not restart that timer. If a
card in the next trick arrives sooner, the current trick takes priority. Local
card input waits while the previous trick is displayed. On reconnect the most
recent completed trick can be shown briefly; no private card history is added.

The application host enables round summaries. After deals
1–4 it holds `DEAL_COMPLETE`, preserving the last trick and finalized scores.
Games wait for the creator to choose Start next deal. The summary displays
names, bids, tricks won, deal scores, and cumulative totals. Deal 5 shows final
scores and winners, with a new-game option rather than another deal.

`POST /test-games/{room_id}/next-deal` accepts `{match_id, deal_number}`. Room
membership and creator ownership are required. The host serializes this operation
with gameplay. Repeating the request for the same completed deal does
not advance twice; stale match or deal identifiers are rejected. Ending a game stops further player actions. The pure engine's phases and rules are unchanged.

The host's `round_summary_seconds` defaults to zero for existing headless test
clients; a positive value enables the manual summary pause without a timer.
The application enables this pause. A `round_review` snapshot
field supplies the completed deal number and whether the viewer can continue.
`remaining_ms` is always null; there is no turn countdown.

Validation includes complete four/five-player manual matches with summary pauses,
creator/membership/stale-request checks, concurrent retries, and manual continuation.
The mocked Chrome regression `client/tests/browser/round-flow.cjs` covers all
phase controls, cut payload, trick highlight expiry, scores, next deal, and final
scores at a narrow viewport. Run with the Playwright setup in the client README.
