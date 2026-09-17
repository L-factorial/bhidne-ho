# Players, friends, and direct messages

The authenticated user ID is also the stable player identity. A player owns one
profile and can find other players, exchange friend requests, and privately message
accepted friends. This social layer is independent of rooms, seats, and game engines.

## Product flow

1. Open **Profile → Players and friends**.
2. Search by username or display name. Search requires at least two characters and
   returns at most 20 users; it never returns the requester.
3. Send a friend request. The recipient may accept or decline it, and the requester
   may cancel it.
4. Accepted friends appear for both players. Either player may remove the friendship.
5. Only accepted friends can read or send messages in their shared conversation.
6. When a recipient accepts or declines a request, the requester receives a durable
   notification. Canceling your own outgoing request and removing an existing friend
   do not create outcome notifications.

The first version has no blocks, group conversations, attachments, delivery/read
receipts, push notifications, or presence disclosure. Direct messages are limited to
500 characters and one send per second per sender/conversation on each backend process.

## Database ownership

```sql
friendships (
  user_low      uuid references users(id),
  user_high     uuid references users(id),
  requested_by  uuid references users(id),
  status        text, -- pending | accepted
  created_at    timestamptz,
  updated_at    timestamptz,
  primary key (user_low, user_high)
)

direct_messages (
  id            uuid primary key,
  sender_id     uuid references users(id),
  recipient_id  uuid references users(id),
  text          text,
  sent_at       timestamptz
)

friend_notifications (
  id          uuid primary key,
  user_id     uuid references users(id),
  actor_id    uuid references users(id),
  kind        text, -- friend_accepted | friend_rejected
  created_at  timestamptz,
  read_at     timestamptz null
)
```

The lower/higher UUID pair makes a friendship unique regardless of request direction.
Deleting a user cascades through friendships and messages. Removing a friendship does
not delete its existing messages, but neither user can access them unless they become
friends again. The API returns only the newest 100 messages in chronological order.

Room chat remains bounded, ephemeral room banter. Direct messages are durable user
data and must not be copied into game logs, analytics payloads, or room history.

## HTTP API

Every endpoint requires `Authorization: Bearer <session token>`.

| Method and path | Purpose |
| --- | --- |
| `GET /players/search?q=...` | Search public player summaries |
| `GET /friends` | Friends plus incoming/outgoing requests |
| `POST /friends/requests/{user_id}` | Send a request |
| `POST /friends/requests/{user_id}/accept` | Accept an incoming request |
| `DELETE /friends/{user_id}` | Decline, cancel, or remove |
| `GET /friends/{user_id}/messages` | Read a friend conversation |
| `POST /friends/{user_id}/messages` | Send `{ "text": "..." }` |
| `GET /notifications` | Newest 50 friend-request outcome notifications |
| `POST /notifications/read` | Mark the current user's notifications read |

Friend/message responses use `Cache-Control: no-store`. Identity comes exclusively
from the bearer session; request bodies cannot choose the sender. Invalid friendship
state returns 409, non-friend message access returns 403, and rate limiting returns 429.

## Follow-up security and scale work

Before a broad public release, add blocking/reporting, moderation and retention rules,
database-backed rate limits, cursor pagination, unread/read state, abuse monitoring,
account export/deletion coverage, and message-content encryption/backups policy. For
multiple backend replicas, deliver notifications through shared pub/sub rather than
assuming the HTTP poll reached the process that accepted a message.
