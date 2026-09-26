# Short-lived pokes and shared phrases

The integration client retains personal phrases and table/private pokes. Reviewed
`/me/phrases` GET/POST/PATCH/DELETE routes use the shared PostgreSQL phrase store;
other gateways observe changes without a local cache. Legacy poke routes stay blocked.

`send-poke` uses the selected table lane with stable command ID, match ID and table
revision. Execution rechecks membership, seating, recipient and match; self-pokes and
empty seats are rejected. It does not update engine/checkpoint revisions or deadlines.
The table claim orders poke authorization against roster changes. This is a short
transaction, not a callback into the legacy game service.

The command receipt and `ROOM_POKE` outbox event commit atomically. Migration 25 adds
a partial `(lane_id, actor_id, completed_at DESC)` index for a 1.5-second sender
cooldown. A command waiting more than 15 seconds is rejected as expired. A successful
poke has a five-second presentation deadline. Retries cannot extend that deadline or
create another event. No room/chat history message is inserted.

Public pokes use the authorized table stream; private pokes have an explicit
recipient audience. The client receives only validated delivery events, filters
expired/wrong-room/private-recipient events, and renders the existing match-scoped
PokeOverlay. Duplicate pages on one subscription do not repeat the presentation;
reconnects within the five-second window may replay the same ID, which the overlay
merges. Presentation failures cannot alter game state or block ACK progress.

Poke payloads are stored in the normal outbox until its retention process removes
them: **short-lived presentation does not mean immediate database deletion**.
Unlike the legacy local connection check, private sends do not claim that the target
is online. Redis presence is advisory, especially during outages; acceptance records
dispatch, not receipt/read. Offline recipients simply miss the display deadline.

The runtime advertises `table_pokes: 1`. All participating servers need that capability
and migration 25 before this command can be admitted to a deployment. Production
selection remains unchanged. Targeted SQL tests cover audience, no engine mutation,
retry, cooldown, spectator rejection and receipt-failure rollback. Client tests cover
validated presentation and duplicate/failed-UI ACK behavior.
