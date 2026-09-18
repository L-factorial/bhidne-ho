# Durable game state

Game durability begins only when a game starts. Rooms and player-room membership
are durable, while pre-game tables, queues, invitations, presence, room chat, and
game chat remain ephemeral.

## Identity and lifecycle

A room may contain multiple active games, so `game_id` identifies gameplay and
`room_id` supplies its durable social and authorization boundary. Starting a game
atomically records its immutable initial state before clients are told that the
game exists. A rematch receives a new game ID.

The same start transaction stores the engine-validated rules, their schema
version, and a canonical SHA-256 digest. A database trigger rejects later rule
updates. Start retries must reproduce the same rules and digest, while recovery
uses those stored rules instead of current application defaults. Each game engine
builds its initial state from this locked rule set.

The stored lifecycle is `active`, `completed`, `abandoned`, `corrupt`, or
`archived`. Completed metadata is independent from the raw event stream so event
retention can be introduced later without deleting results.

## Reconstruction contract

Every durable engine implements pure hooks equivalent to:

```python
proposed_events = game.decide(state, actor_id, command, payload)
new_state = game.reduce(state, committed_event)
```

The invariant is:

```text
decode(initial_state) + ordered canonical events = authoritative current state
```

Reducers do not read clocks, generate randomness, perform I/O, or deliver client
messages. Random outcomes, IDs, and relevant absolute times are facts recorded in
the initial state or event payload. Canonical events contain complete server-side
facts and are distinct from public/private transport projections.

One command may append several events in one transaction. This includes immediate
server-controlled transitions such as recycling an exhausted pickup pile,
shuffling its replacement, scoring, advancing a phase, or completing a round. An
internal event may project to no client message at all; it is still persisted and
replayed. Random transitions record their authoritative outcome (for example, the
exact shuffled card order) instead of rerunning randomness during recovery.

Persisted formats carry engine and event schema versions. Recovery rejects gaps,
unsupported versions, and invalid state progression instead of guessing.

## Command transaction

Each authenticated player action, timer, and controller action uses one durable
path:

1. Verify current room membership and game ownership.
2. Lock the game row and validate the fencing epoch.
3. Return a matching durable command receipt, if one exists.
4. Validate the expected revision and decide events against detached state.
5. Store the command receipt and consecutive events, then advance the game row.
6. Commit before replacing in-memory state or delivering messages.

A command ID is scoped by game and actor. Reuse with different request content is
a conflict. Accepted and game-level rejected outcomes are durable. Network
delivery remains best effort; clients reconcile using authoritative snapshots.

## Recovery and ownership

Any server can acquire an expired game lease, increment its fencing epoch, load
the initial state, replay contiguous events, verify the resulting revision, and
resume the game. A stale owner cannot commit with an old epoch. Absolute deadlines
are recovered as idempotent server commands rather than relying on surviving
in-process timer tasks.

The shared in-memory contract and PostgreSQL store implement atomic creation,
receipt lookup, event append, revision advance, replay, and commit-before-delivery.
Echo proves deterministic reconstruction and lost-response recovery through that
runtime. Atomic game start also reserves every player, establishes the first
ownership epoch, and issues a hashed fencing token. Lease acquisition, renewal,
expiry takeover, and per-command fencing are implemented by both stores; a durable
`active_game_players` uniqueness constraint prevents a player from starting two
games concurrently. Production endpoint routing, automatic lease-renewal workers,
terminal-game finalization, and conversion of Call Break, Marriage, and Flush are
subsequent increments; existing game mutation paths have not switched yet.
