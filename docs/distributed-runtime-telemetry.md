# Runtime telemetry (O1)

The distributed runtime uses `prometheus-client` and `structlog` with Python logging.
This increment instruments the isolated distributed path, not the legacy server or
native client. No database migration or Grafana account is required. Exporters for
host/PostgreSQL/Redis internals, actual alert destinations and capacity tests are
separate deployment work; application metrics do not replace those exporters.

## Enable and collect

The executable bootstrap configures the dedicated `bhidne.runtime` JSON logger.
For an embedded `build_server`/`create_integration_app` assembly, explicitly call
`configure_logging()` and attach `RuntimeTelemetry` to the embedding lifespan.

Set `BHIDNE_DISTRIBUTED_METRICS_PORT=9108` to enable the separate metrics listener
and background sampling. `BHIDNE_DISTRIBUTED_METRICS_ADDRESS` defaults to
`127.0.0.1`. Scrape `http://127.0.0.1:9108/metrics` with Alloy on the same host.
The public HTTP/WS application does not expose metrics. Run ONE application process
per listener/registry; a multi-worker uvicorn command is not supported by this
configuration. Give separate processes distinct listener ports and scrape targets.

The integration compose file binds metrics to the internal container network only,
without publishing a host port. A container collector must scrape each gateway's
port 9108 separately. Do not route this port through nginx or the public load
balancer; enforce private firewall access when binding a Droplet private address.
This listener has no authentication. A listener bind failure aborts startup and
cleans up the application; a later collector/Grafana outage does not block games.

`deploy/alloy.distributed.alloy` is a same-host configuration example. It scrapes the
application and tails an explicitly configured log file. Configure deployment
instance/environment labels, endpoints and restricted ingestion credentials outside
source control. Capture service stderr into the selected rotated file, or replace
the file source with Alloy's Docker/journal source for your deployment. Persist
Alloy's storage directory for log read offsets and remote-write buffering. The
example is not automatically deployed and does not configure cloud dashboards.

Launch uvicorn with `--no-access-log` (already set in the distributed Dockerfile).
The integration nginx also disables default access logging, because default request
lines include OAuth callback query values. Runtime HTTP metrics use route templates
and never record query strings, raw URL paths, headers or bodies. Review any external
proxy/provider access-log configuration separately. Third-party error loggers are
not reformatted or scrubbed by the runtime logger.

## Coverage and metric semantics

| Flow | Instrumentation |
| --- | --- |
| HTTP, including shared auth/profile routes | Route-template request count, status class and duration; 5xx log |
| WebSockets | Accepted live connection gauge and open/close events; session-check attempts/errors |
| Durable room creation | Transaction duration/error and post-commit creation/deduplication log |
| Hosted/chat/social ingress | Duration/errors, committed enqueue versus duplicate response, failed advisory wakeup |
| All eight command lane kinds | Post-commit accepted/rejected counter, transaction duration and correlated log |
| All three game engines | Game execution attempt timing and committed outcomes by game type |
| Tables, offers, rules, rematches, departures, invitations, pokes, manual settlements | Shared table/room command outcome instrumentation and execution timing |
| Checkpoint loading/saving | Operation duration/error; write-in-transaction is explicitly a step, not a commit |
| Timers and automatic match/Flush settlement | Dispatch/finalization duration/errors, projected/no-payment/already-completed results |
| Recovery/ownership/placement | Acquisition/renewal/heartbeat/quarantine/release timing/errors, recovery result, activation/retirement logs with room and epoch |
| Scheduling and polling | Scan/sweep timing, full scheduler counter, retry failures, room retirement |
| Redis and presence | Publish results, connection/dispatch/refresh failures, availability transitions |
| Outbox and delivery | Claim/finish/page/ACK timing, publication failures, sent-page/backpressure counters, subscription counts |
| Database/pool | Pending inbox/outbox counts and oldest ages, sample freshness, pool wait/error/availability snapshots |

Metric families:

- `bhidne_operations_total{operation,result}` and `bhidne_operation_seconds{operation}`:
  method attempts. `returned`, `false`, `idle` (returned None), `error`, `cancelled`,
  plus a bounded set of known domain statuses. These are not business acceptance.
  Parent/child method observations overlap: do not sum durations across operations.
- `bhidne_submissions_total{lane_kind,result}`: committed HTTP ingress observations,
  `enqueued` or `duplicate`. Excludes internal timer/notification enqueues.
- `bhidne_command_outcomes_total{lane_kind,result}`: observed accepted/rejected
  commits across every lane. `bhidne_game_command_outcomes_total{game_type,result}`
  is the gameplay-only subset for Call Break, Marriage and Flush.
- `bhidne_command_transaction_seconds{lane_kind}`: claim/pool/lock/execute/commit
  wall time. NOT enqueue-to-execution latency; use oldest-pending age for backlog.
- `bhidne_runtime_events_total{event}`: static-name transitions/failures. A sent page
  or published Redis hint is not a client acknowledgment.
- `bhidne_http_requests_total{route,method,status}`, `bhidne_http_seconds{route}`
  and `bhidne_websocket_connections`: transport measurements. The socket gauge
  counts accepted sockets, not unique authenticated users.
- `bhidne_runtime_state{state}`: sampled local/runtime and database gauges.

Committed command counters run after transaction exit and final fencing. Replays of
completed commands do not count another execution. Rollbacks, cancellation and
unknown commits do not emit confirmed success; a crash after commit but before
observation can lose a metric/log. Never use telemetry for billing or exactly-once
accounting: durable receipts remain authoritative. Database step metrics may count
work that a surrounding transaction later rolls back.

## Sampling and operational interpretation

With metrics enabled, sample local state and pending database rows every 30 seconds.
Database sampling is read-only, with a two-second overall timeout and 1.5-second
per-statement timeout. It uses pending predicates backed by existing partial indexes;
large pending sets can still time out. Failed samples retain last values and set
`database_sample_ok=0`; always check `database_sample_timestamp_seconds` for freshness.
Scrapes read memory and never issue SQL. Shutdown cancels sampling before pool closure.

Both servers sample the same global database backlog. Aggregate with `max`, NOT
`sum`, across replicas of the sampler, and alert separately when samples are stale.
Local connection/room/scheduler gauges are per-process; tracked rooms can include
rooms staged during recovery. Pool wait/error snapshots are cumulative gauges from
psycopg, not request latency histograms. There is no measured client end-to-end
latency or per-client delivery-age metric in this increment.

## Logs and privacy

JSON logs contain timestamp, level, fixed event name and allowlisted metadata:
room/table/game/lane/command identity, sequence, epoch, game type, outcome and error
class. They omit actor identity, cards, checkpoint/payload bodies, chat contents,
credentials, auth tokens, exception messages and trace locals. Treat correlation IDs
as sensitive operational metadata nonetheless; apply access controls and retention.
Alloy adds the process instance label; IDs remain JSON fields, never Loki labels.

Failure log repetition is limited to once per event/operation per 30 seconds, while
metrics count every occurrence. Routine poll successes and each page send are not
logged. Command commits are logged once per observed execution. These are local
synchronous stderr writes, not network calls; configure log rotation and collection
backpressure so a stalled local log sink does not stall the process. Telemetry emit
exceptions are suppressed and cannot turn a committed command into a retry.

## Initial dashboards/alerts

Scope these queries by environment/job when importing them into Grafana:

- Execution failures: `sum by (operation) (rate(bhidne_operations_total{result="error"}[5m]))`
- Gameplay outcomes: `sum by (game_type,result) (rate(bhidne_game_command_outcomes_total[5m]))`
- Execution p95: `histogram_quantile(0.95, sum by (le) (rate(bhidne_operation_seconds_bucket{operation="execute.game"}[5m])))`
- Connections: `sum(bhidne_websocket_connections)`
- Backlog: `max(bhidne_runtime_state{state="commands_pending"})`
- Oldest pending command: `max(bhidne_runtime_state{state="commands_oldest_seconds"})`

Starting alert rules to tune during staging:

- Scrape target `up == 0` for one minute (also configure missing-target detection).
- `database_sample_ok == 0` for one minute, or last sample older than 90 seconds.
- `redis_available == 0` for one minute: degraded polling mode, not proven data loss.
- Oldest pending command >30 seconds for two minutes, with fresh database samples.
- Scheduler unhealthy for one minute while server_running is 1.
- Sustained HTTP 5xx and increased execution errors compared with test baseline.

Outbox unpublished age measures advisory publication backlog, not proof of client
non-delivery: gateways reconcile even when Redis is unavailable. Durable inbox
rejections include normal invalid/stale player commands and should not all page an
operator. Existing capacity/latency targets remain unverified.
