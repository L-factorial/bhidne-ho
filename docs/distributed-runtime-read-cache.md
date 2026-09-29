# Versioned room and player projection caches

Room/table snapshots, table-user relationships, activity/membership previews and
invitation previews use a shared bounded cache: process memory, then Redis, then
full PostgreSQL reconstruction. HTTP refreshes triggered by delivery notifications
use this same path and populate the new version before returning it to the user.

A small authoritative PostgreSQL read still precedes every hit: authorization,
room/table inventory and committed dependency versions come from one repeatable
read snapshot. This intentionally keeps access decisions and version checks out
of an eventually consistent cache. It avoids expensive checkpoint/event/receipt
reconstruction on hits; it does not eliminate all SQL or permit reads during a
database outage. Commands, fences, durable receipts and authentication remain
fully authoritative. Ledger, chat and lobby-page queries retain their existing
bounded database reads.

Shared-platform profile, appearance, public-player, batch-player, exact directory,
substring search and friendship-list payloads now use the same bounded memory/Redis
cache. Their keys include user/profile/account MVCC versions and, for friendship
lists, the relationship versions. Directory candidate pages are rechecked in SQL
with deterministic ordering and a 20-result limit, so new accounts, renames,
deletions and previously empty searches cannot reuse stale results. Both dependency
selection and a miss loader run in the same repeatable-read snapshot. This caches
payloads, not the search index: directory hits still execute candidate selection.

Committed edits immediately make old keys unreachable on every gateway; the next
read populates the new version. This is lazy version invalidation, not synchronous
fan-out of writes to every process. It also works for writes from other services
and when Redis is unavailable. Authentication and friendship permission checks
continue to query authoritative state. The shared platform and room readers share
one cache budget per gateway, rather than allocating a new budget per read family.

Keys include the actor, selected table/read mode, room metadata and MVCC row
versions for table/recovery/game state, membership, positions and associated
profiles/accounts. Every committed update changes a dependency version, including
same-revision receipt/profile updates. A removed membership is denied before cache
lookup. Deleted/private rooms cannot reuse an old public preview. A delayed old
read writes only its old version; it cannot overwrite a newer projection. Missed
Redis notifications do not affect correctness. This needs no schema migration or
per-command room/global cache lock.

Defaults per application process: 256 entries, 16 MiB serialized payload budget,
512 KiB maximum value, 30-second expiry and 150 ms maximum Redis operation time.
Redis entries also expire after 30 seconds; old versions become unreachable
immediately and are reclaimed by expiry. Oversized entries bypass caching. Redis
failures and malformed cached values fall back to database reconstruction, and
cancellation propagates. Returned JSON is detached from stored memory. Redis is
private application infrastructure and now holds actor-specific projections;
its existing private-network/access-control requirements apply. No cache content
is logged or exported through metrics.

Verification covers multiple cache instances, copy isolation, old-fill ordering,
expiry/size limits, malformed entries, Redis failure, profile changes, room access
revocation, profile/appearance edits across gateways, directory insertions/deletions,
friendship changes and all three games using actual PostgreSQL queries. This is a
correctness increment, not a measured capacity or latency guarantee.
