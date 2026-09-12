# Ephemeral room chat and participation

Room chat is a shared multiplayer feature for playful room banter. It is separate
from game commands, engine events, score history, and personal poke phrases.
Messages remain in bounded memory, including after future database adoption.

## Ownership

| Component | Responsibility |
| --- | --- |
| `app/models/chat.py` | Input contract: text only, 1-500 Unicode characters, trimmed, no blank/control-only messages. |
| `app/multiplayer/room_chat.py` | Membership and participation policy, per-sender cooldown, sender profile, bounded room history; transport-independent exceptions. |
| `app/multiplayer/participation.py` | `ParticipationSource` protocol and `GameParticipation` aggregation over registered host sources. |
| `app/transport/room_chat.py` | Authentication, request validation, no-store responses, translation of service exceptions into HTTP 403/429. |
| `app/test_games/service.py` | Call Break's `is_playing(room_id, user_id)` implementation, reading authoritative host state. |
| `app/main.py` | Constructs the hosts, participation aggregator, and shared chat service through constructor injection. |
| `client/src/components/RoomChat.tsx` | Room panel, draft, polling, unread nudges and notification sound. |

The chat service imports neither FastAPI nor Call Break. The transport does not
inspect game state. `is_playing` is a synchronous, side-effect-free query: true
for a seated player in an active unfinished game, including between-deal review;
false for waiting lobbies, spectators, finished games, and ended games. Sources
must read current state rather than maintain a second participation cache.

To integrate another game, implement this protocol on its host and include that
host in `GameParticipation(...)` in the composition root. Any source reporting
active play blocks that user's chat in that room. Sources must be registered
explicitly; the aggregator does not automatically discover game-registry entries.
Echo currently has no seated match lifecycle and is not a participation source.

## Wire contract and behavior

- `GET /rooms/{room_id}/chat` returns the latest 100 messages in send order.
- `POST /rooms/{room_id}/chat` accepts `{text}` and returns the created message.
- Message shape: `{id, sender_id, sender_name, text, sent_at}`; timestamp is Unix milliseconds.
- Both require authentication and a current room connection, and deny active players.
- One-second per-sender cooldown returns 429; membership/participation denial returns 403.
- Names are captured at send time, with Guest as fallback. New room members can read retained history.
- Clients poll about once per second. Chat does not introduce an adapter command or engine event.
- Leaving stops client polling; the server denies further access once room presence is removed.
- History resets on backend restart and is never archived to a database, backups, or analytics payloads.

These HTTP routes and response bodies are unchanged by the refactor. Storage and
participation checks assume the existing single-process, in-memory deployment.
A future distributed host must provide a consistent participation source and
shared ephemeral delivery without introducing durable chat storage.

## Verification

`tests/test_room_chat.py` covers the public HTTP contract, identity, membership,
validation, cooldown, bounded history, and Call Break lifecycle restrictions.
`tests/test_game_participation.py` checks multiple independent sources, immediate
state changes, room/user isolation, and chat with a non-Call-Break source.
