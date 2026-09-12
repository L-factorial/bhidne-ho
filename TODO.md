# Project TODO

## Current priority

Refine the game logic, player flow, and UI. Backend persistence is deliberately
deferred until that refinement is complete and the user chooses to resume it.

## Deferred: recover games after a backend restart

Status: deferred at the user's request on September 11, 2026. Do not treat this
as the next active increment while game logic, flow, and UI are being refined.

Network reconnects already preserve seats and resolve pending commands, but a
backend restart still clears in-memory credentials, rooms, matches, and receipts.

### Scope to revisit

- [ ] Persist guest sessions, rooms, seats, and match state.
- [ ] Save each command's outcome and updated match state in one transaction.
- [ ] Restore active matches and define how turn deadlines behave across downtime.
- [ ] Keep persistence behind shared interfaces usable by every game adapter.
- [ ] Add restart/reconnect tests for both Call Break and the test engine.
- [ ] Document startup recovery, persistence limits, and local database setup.

Suggested starting point, to reassess when resumed: SQLite with the existing
single-server model. Multi-worker coordination is outside this proposed increment.

### Acceptance criteria

Restart the backend during a game, then reconnect with the same guest identity.
The player recovers the same seat and the correct private hand, turn, and scores.
Retrying a command accepted before the restart returns its recorded outcome
without applying another move. State and receipts must remain consistent if the
process stops during a command transaction.

### Existing foundation

- [Shared command runtime and adapter contract](docs/shared-game-runtime.md)
- [Reliable actions and current recovery limits](docs/reliable-game-actions.md)

To resume: ask to implement the deferred backend-restart recovery item in this file.
