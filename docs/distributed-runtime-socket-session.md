# C3e: established-socket session validity

Distributed delivery sockets now own a `SocketSession` for the exact token supplied
in their AUTH frame. The initial check and subsequent checks use the same authenticator
as HTTP requests. With `PostgresAuthService`, checks consult `auth_sessions` and its
expiry condition; revocation on another server is visible without a Redis signal.
User identity must remain identical throughout the connection.

## Enforcement and timing

- A per-socket watchdog rechecks idle sockets independently of PINGs or incoming frames.
- Incoming operations and outbound frames also pass the freshness gate. Cached
  confirmation is reused only within the check interval; concurrent checks share a
  lock. There is no extra authentication query for every event while confirmation
  remains fresh.
- Defaults are a five-second interval and a two-second authentication timeout. Freshness
  is measured from the beginning of a successful check, not its completion. A check
  returning after its freshness window cannot permit delivery.
- Logout/revocation/expiry or changed user identity closes the socket with 1008.
  Verification exceptions/timeouts close it with 1011; an authentication-store outage
  does not leave sockets indefinitely authorized using an old result.
- Invalidating one token affects sockets using that token, not all tokens for that
  user. Another device's separately issued token remains valid.

This is bounded eventual detection, not instantaneous cross-server logout. Under
normal scheduling, a revocation just after confirmation is detected at the next
five-second check plus verification time (up to two seconds). No hard wall-clock
promise applies during an event-loop/process pause. Before a later send, stale
confirmation must be checked again. Frames already sent or in flight are not recalled;
a check and a concurrent logout are not one atomic database/socket operation.

The watchdog runs once per socket; it is bounded by existing connection/request
admission, with one serialized authentication check per socket. Checks currently are
not batched or shared across connections using the same token. Capacity testing and
any optimization of this database load remain the later task set.

## Closure and cleanup

Session failure closes local admission, interrupts the owning socket loop and removes
its subscriptions. Cleanup joins the watchdog and removes presence registrations using
the existing cancellation-safe cleanup path. Late saved delivery callbacks cannot
send after the session is stopped. Redis removal failures still expire by TTL; none of
this changes room membership, seats, game ownership or durable command receipts.
Ordinary server-shutdown cancellation retains close code 1012. No client-provided frame
can renew or replace the authenticated token on an existing socket; reconnect requires
normal authentication.

The legacy single-server socket implementation remains unchanged. Production still
selects that legacy application. C3e is wired into the explicit distributed transport
and integration application only, not enabled as a production runtime switch.

## Verification and next step

43 targeted socket/transport/server/application/platform tests passed. Eight new tests
cover idle revocation, identity change, verification failure/timeout, PostgreSQL token
revocation and expiry through a separate auth-service instance, another token remaining
valid, freshness enforcement, presence/subscription cleanup and late callback rejection.
The database tests use PostgreSQL/WASM and simulated ASGI sockets; separate auth-service
instances are not independent-process failover evidence. Two existing Starlette warnings
remain. Python compilation and whitespace checks passed.

Next: **C3f — browser/provider sign-in composition**. Manual settlement compatibility,
remaining client mappings, production writer exclusion, independent-process checks and
load-balancer/platform integration remain open. No migration or frontend change is
introduced by C3e.
