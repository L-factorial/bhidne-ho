# Standalone Call Break implementation

The engine runs a complete five-deal match using local player IDs 1–4 or 1–5.
It imports only `card_utils` and Python's standard library. A separate
[test-console host](test-callbreak-console.md) connects it to four/five-player
test lobbies with three-second automatic actions. Chat/PING still use EchoGameEngine;
production adapter integration remains separate.

For a step-by-step explanation of player IDs, turn order, command dispatch and
the application loop, read [Playing loop and player identities](callbreak-playing-loop.md).

## Component ownership

```text
MatchState                            callbreak/game.py
├── GameConfig                        callbreak/config.py
│   └── RedealPolicy                   callbreak/house_rules.py
├── current_deal: DealState           callbreak/deals.py
│   ├── players: PlayerDealState      remaining hand + bid, per player
│   ├── undealt_cards                 two for five players; zero for four
│   ├── current_trick: Trick          callbreak/models.py
│   │   └── plays: tuple[Play, ...]   player ID + card
│   └── completed_tricks              full ordered play history
├── completed_deals                   finished deals + DealResult
└── abandoned_attempts                private audit history of redeals
```

Four players: 13 cards each, 13 tricks per deal, four plays per trick.
Five players: 10 cards each, 10 tricks per deal, five plays per trick.
Exactly one player wins each trick and leads the next. Match scores are summed
over five completed deals; ties produce multiple match winners.

Trick stores both partial and complete trick values, with `.complete` and
`.current_player` derived from plays. `resolve_trick` derives the winning player.
Deal `.tricks_won` is derived from completed tricks. Match `.current_player`,
`.score_tenths`, and `.winners` are also derived to prevent conflicting state.

## Run a complete game without a server

```sh
source .venv/bin/activate
python -m callbreak --players 4 --seed 7
python -m callbreak --players 5 --seed 7
```

This is a deterministic simulation: each local player accepts the dealt hand,
bids one, and chooses random legal cards. It prints five deal results and the
match winners, then verifies history and replay. It is not a strategy bot or a
multiplayer UI. Seeded randomness is for reproducible simulations; a live host
should prepare decks with `random.SystemRandom()`.

## Reducer API

```python
from random import SystemRandom
from card_utils import shuffle, standard_52
from callbreak import (
    GameConfig, StartDeal, AcceptHand, PlaceBid, PlayCard, Transition,
    apply_control, apply_player, available_cards, create_match,
)

state = create_match(GameConfig(player_count=4), initial_dealer=1)
result = apply_control(state, StartDeal(shuffle(standard_52(), rng=SystemRandom())))
assert isinstance(result, Transition)
state = result.state

# Default house rules give everyone a chance to review or request a redeal.
for player in state.config.players:
    result = apply_player(state, player, AcceptHand())
    assert isinstance(result, Transition)
    state = result.state

for _ in state.config.players:
    result = apply_player(state, state.current_player, PlaceBid(1))
    assert isinstance(result, Transition)
    state = result.state

player = state.current_player
card = available_cards(state, player)[0]
result = apply_player(state, player, PlayCard(card))
assert isinstance(result, Transition)
state = result.state
```

Successful commands return `Transition(state, events)` with one revision increase.
Rejections return `PlayRejection(code, detail)` and leave the old state unchanged.
All engine-produced state is immutable. The caller retains the returned state;
there is no global engine singleton. Keep states produced by the reducer or
validated replay; dataclass construction is not a checkpoint-import API.

Player commands: `AcceptHand`, `ClaimRedeal`, `PlaceBid(amount)`, `PlayCard(card)`.
Control commands: `StartDeal(deck)`, `Redeal(deck)`; player dispatch rejects them.
No random calls occur inside the reducer. A fresh explicit ordered deck is
required for each deal or redeal, allowing exact replay.

```text
AWAITING_DEAL → HAND_REVIEW → BIDDING → PLAYING
                    ↓                       ↓
              AWAITING_REDEAL          DEAL_COMPLETE → next deal
                    ↓                       or
               HAND_REVIEW            MATCH_COMPLETE (deal 5)
```

If both redeal options are disabled, dealing enters BIDDING directly.
Between deals, only the trusted controller starts the next deal. The engine
never starts a timer, creates a socket, or automatically changes a seat.

## House rules and pre-game agreement

Defaults are no card greater than Jack **or** no spades, allowing that player to
request a full redeal before bidding. Jack/Queen threshold and both enable flags
are configurable. This implements the previously proposed interpretation of
“restart”: the entire distribution is replaced, preserving dealer, deal number,
and previous scores. A trick cannot be restarted after play begins.

For five players, the two undealt cards remain hidden and unused. This implements
the previously proposed leftover-card default; no rank is removed in advance.

```python
from card_utils import Rank
from callbreak import GameConfig, RedealPolicy
from callbreak.setup import MatchSetup

setup = MatchSetup(GameConfig(5), admin=1)
config = GameConfig(5, redeal_policy=RedealPolicy(
    weak_hand_enabled=True,
    weak_hand_threshold=Rank.QUEEN,
    no_spades_enabled=False,
))
setup = setup.propose(2, config, expected_revision=setup.revision)
for player in setup.config.players:
    setup = setup.accept(player, expected_revision=setup.revision)
setup, state = setup.start(1, expected_revision=setup.revision)
```

Any participant can propose by default; `anyone_can_edit=False` restricts this
to the admin. Changes clear all earlier acceptances. Everyone must accept the
same settings revision before the admin starts. Settings then freeze. A player
count change requires a fresh setup and fresh agreement.

MatchSetup is an optional standalone coordinator. Its actor is a trusted local
player ID. The future platform must map authenticated users, serialize setup
updates, retain each returned setup, and provide UI controls. `create_match`
remains directly available for trusted scripts and bots.

## Validation, scoring and history

`callbreak/rules.py` enforces following suit, beating when possible, winning
trumps when void, and free discard when no winning trump is available. Ownership,
turn and phase are checked against authoritative state. Rejected plays are never
inserted into history.

`score_deal` in `scoring.py` uses integer tenths: bid 4 and win 6 gives 42 (4.2);
bid 4 and win 3 gives −40. No floating-point values are stored in game scores.

`audit_deal` reconstructs initial hands from remaining cards and recorded plays,
then revalidates each historical move. It detects an earlier failure to follow
suit or beat when able. `DealState.void_suits(player)` derives suit deductions
from accepted plays for that attempt only. Merely playing a higher card later
does not itself imply an earlier violation; the earlier trick's context matters.
`audit_match` also checks card conservation, turn progression, dealer rotation,
deal boundaries and score consistency.

## Private information and replay

### Public query API

Use `GameQuery` from `callbreak` to read game information without navigating the
internal state models. Every result is a detached, JSON-ready dictionary or list;
card IDs are strings and scores are integer tenths.

```python
from callbreak import GameQuery

query = GameQuery(state)
query.get_state()                  # Phase, revision, progress, scores, winners
query.get_turn()                   # Current player and action awaited
query.get_rules()                  # All effective game and house rules
query.get_current_trick()          # Leader, led suit, plays, winning card so far
query.get_bids()                   # Player ID and bid, for every player
query.get_deal_table()             # Bid, tricks won, cards remaining, deal score
query.get_deal(1)                  # First deal, including its table and tricks
query.get_trick(2, deal_number=1)   # Second trick of the first deal
query.get_tricks(1)                # All started tricks of the first deal
query.get_deals()                  # All started deals, in order
query.get_scoreboard()             # Five deal scores and cumulative total per player
query.get_player(2)                # Public player statistics; no hand
query.get_player_view(2)           # PRIVATE: player 2's hand and legal choices
```

`GameQuery` reads the exact immutable revision passed to it. After a successful
command, use `query = GameQuery(result.state)` to query the updated game. An older
query stays on its original revision, and editing a returned dictionary cannot
change either the query or the game state.

Methods with an optional deal number default to the active deal, or the most
recent completed deal between deals/after the match. Before the first deal,
`get_deal()` returns None and list queries return empty lists. `get_current_trick()`
always refers to the active trick and returns None during review, bidding, and
deal boundaries; use `get_trick` or `get_tricks` to inspect finished tricks.
Deal and trick numbers are one-based. Invalid numbers or player IDs raise
ValueError; well-formed numbers for deals/tricks that have not started raise
LookupError. Abandoned private redeal histories are not exposed by these queries.

The trick response distinguishes `winning_player`/`winning_card` (the current
leader in a partial trick) from `winner` (only set when all players have played).
`get_turn()` reports `REVIEW_HAND` with multiple `pending_players` during review,
`PLACE_BID` or `PLAY_CARD` with one current player, and a `controller_action` of
`START_DEAL`/`REDEAL` at the appropriate boundary. At match completion, neither a
player nor controller action is awaited.

Example deal-table row:

```json
{"player_id": 2, "bid": 4, "tricks_won": 3, "cards_remaining": 7, "score_tenths": null}
```

A deal score remains None until that deal is scored; the scoreboard likewise
uses None for all unscored deal columns. “Hands won” means `tricks_won` in this API.
This is separate from `cards_remaining`, the size of the player's actual hand.

General queries contain only public information. `get_player_view(player_id)`
requires a trusted viewer ID: a platform must authenticate and authorize the
viewer before calling it. It returns only that player's hand, legal cards and
review eligibility, plus public state. The query object is a server/local API,
not a security sandbox against a caller who already has the authoritative state.
Existing `public_view`/`player_view` functions remain available for compatibility.

### Existing projections and trusted replay

`public_view(state)` returns public state and scores. `player_view(state, player)`
adds only that player's hand, legal choices and review eligibility. Returned
dictionaries are detached projections. Full MatchState contains everyone's
cards and private abandoned attempts and must never be broadcast.

Each domain Event has a name, revision, index, immutable data pairs and recipient.
`recipient=None` is public; an integer is private to that player. These are Python
domain values, not JSON wire envelopes. The future adapter must explicitly map
recipients to authenticated users and deliver privately within the correct room.

```python
from callbreak.replay import Entry, Replay

# Append only accepted commands, with actor=None for trusted control commands.
record = Replay(config, initial_dealer=1, entries=tuple(accepted_entries))
private_json = record.dumps()
restored = Replay.loads(private_json).restore()
```

Replay JSON has a schema version, frozen configuration, initial dealer and exact
accepted commands/decks. Loading replays every command through validation;
unknown versions or invalid sequences fail. This is the supported trusted
checkpoint/recovery format, not arbitrary state deserialization. Store records
privately: all original and abandoned decks are included. No file or database
I/O happens in the engine.

## Shared card utilities

`card_utils/cards.py` supplies Card, Suit, Rank and strict canonical IDs such as
`10H` and `AS`. `card_utils/operations.py` provides `standard_52`, `shuffle`, `mix`,
`combine`, `split`, `cut`, `draw`, and round-robin `deal`. Operations return new
tuples, preserve duplicates and order where applicable, and accept generic
sequence items. Trump and trick rules live only in Call Break.

## Tests and integration boundary

```sh
python -m pytest -q
```

Coverage includes complete matches for both sizes, review on/off, private views,
redeals, invalid commands, pre-game agreement, scoring, audit, deterministic
replay and deck operations, alongside existing multiplayer regressions.

The platform adapter, private WebSocket delivery, browser gameplay UI, durable
storage, network retry handling, and disconnect/timeout policy remain separate
integration work. The standalone core does not import or alter those services.
