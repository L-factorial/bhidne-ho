# Social room feed and room visibility

The authenticated room directory is the first social feed. It shows active or
game rooms in this order:

1. rooms created by the signed-in player;
2. rooms the player has joined;

Rooms owned by friends and other public rooms are not listed until the player joins
them, normally through a shared room code. Each response labels an item with
`feed_source` (`you` or `joined`). Joined-room membership is persisted; current room occupants and online
presence remain runtime state and are overlaid onto the persisted room metadata.

Joining a persisted room creates a durable membership, so it remains in that
player's feed after disconnecting or restarting the application. Explicitly leaving
the room removes that membership. WebSocket presence remains ephemeral.

## Creating and entering rooms

`POST /rooms` accepts:

```json
{ "name": "Friday table", "visibility": "friends" }
```

`visibility` is either `public` or `friends` and defaults to `public` for older
clients. A public room can be entered by every authenticated player with its code.
A friends-only room can be entered only by its creator and currently
accepted friends. A pending friend request is not enough.

The server checks this policy on the room feed, room snapshot, REST entry, and
WebSocket connection. Knowing or sharing a friends-only room code does not bypass
the check. Existing ad-hoc room IDs that have no persisted metadata remain public
for compatibility with developer/test clients.

## PostgreSQL schema

```sql
rooms (
  id          text primary key,
  creator_id  uuid not null references users(id) on delete cascade,
  name        text not null,
  visibility  text not null, -- public | friends
  created_at  timestamptz not null
)

room_memberships (
  room_id     text references rooms(id) on delete cascade,
  user_id     uuid references users(id) on delete cascade,
  joined_at   timestamptz not null,
  primary key (room_id, user_id)
)
```

Room metadata survives application restarts. Current members, connected members,
game engines, and game state are still in application memory; after a restart a
player can enter a persisted room and its runtime state is provisioned again.

This storage uses the normal `BHIDNE_HO_DATABASE_URL`, so it is not coupled to the
Docker PostgreSQL container. Moving test or production to a managed PostgreSQL
service only requires migrating the data and changing that URL.

## Ownership and tables

Only the room creator can call `DELETE /rooms/{room_id}`. Deletion removes the room
and its memberships, closes live connections, and discards its ephemeral game
tables. Deleted IDs are retained as tombstones so an old room code cannot recreate
the deleted room as an ad-hoc test room.

Room ownership does not imply table ownership. Every player who has entered the
room is a room member and may create a game/table through `POST /test-games/{room_id}`.
Individual game rules still determine who may configure, start, or act at a table.

Exiting has ownership-aware wording in the client. An owner uses **Exit room**: this
ends their current membership/presence but keeps the owned room in their feed. A
non-owner uses **Leave and exit room**: this also removes their durable joined-room
membership, so the room disappears from their feed. Neither action deletes a room.

## Current boundaries

This milestone does not include posts unrelated to rooms, reactions, comments,
room archival/restoration, pagination, invitations that override visibility, or live
revocation of an already-open WebSocket when a friendship is removed. A removed
friend is denied on the next REST request or WebSocket reconnect.
