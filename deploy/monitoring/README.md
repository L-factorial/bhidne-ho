# Production metrics and filtered logs

Grafana Cloud endpoints are configured for the owner's `honestcheese2384` stack.
Alloy is installed on the four existing Ubuntu 24.04 servers. No new droplet or
public monitoring port is required. No app, PostgreSQL or Redis restart is needed.
The playbook changes monitoring services and adds dedicated DB/cache monitoring
accounts; it does not deploy the app or create gameplay data.

## Configure and apply

From the repository root, save an ingestion token using a hidden local prompt:

```sh
python3 deploy/monitoring/configure-secrets.py
```

The token must have `metrics:write` and `logs:write` access to this stack. Use a
replacement for any token shared in chat. The helper writes mode 0600 JSON (valid
YAML) to `deploy/provision/monitoring.local.yml`, covered by `.gitignore`. It also
generates a separate Redis monitoring password, preserved on subsequent runs.
Do not paste secrets into shell arguments, screenshots, issue reports or Git.

Use the existing verified inventory, application service secrets and Ansible setup:

```sh
bash deploy/monitoring/run.sh --vault-password-file .vault-password.local.yml --syntax-check
bash deploy/monitoring/run.sh --vault-password-file .vault-password.local.yml
```

If Ansible is not on PATH, set `ANSIBLE_PLAYBOOK` to its absolute executable path.
Keep strict SSH host verification enabled. For this workstation, the verified
host file can be specified through:

```sh
bash deploy/monitoring/run.sh --vault-password-file .vault-password.local.yml --ssh-common-args='-o StrictHostKeyChecking=yes -o UserKnownHostsFile=/private/tmp/bhidne-prod-all-verified-known-hosts'
```

The repository is signed via the official Grafana APT key; Alloy is pinned to
1.20.0-1, available in APT when prepared. Configuration is validated before
activation. Package installation suppresses default service autostart. An existing
Alloy config is managed/replaced by this playbook: use only the dedicated hosts in
the existing inventory. Run hosts serially. A failed host stops the rollout.

## Coverage and limits

- All four hosts: selected CPU, RAM, load, disk, filesystem and network metrics
  every 60 seconds. Alloy queue/failure/resource metrics are collected too.
- App hosts: existing private `127.0.0.1:9108` runtime metrics every 30 seconds.
  This reads exported counters, not game snapshots; it adds no client polling.
- PostgreSQL: embedded exporter, local socket/peer authentication as OS/database
  user `alloy` with `pg_monitor`. No application password is given to Alloy.
- Redis: dedicated `bhidne_monitor` ACL, INFO/PING and selected diagnostic commands;
  no application keys, writes, CONFIG, raw SLOWLOG GET or client-list export.
  The monitoring include survives subsequent service reprovisioning.
- Logs: a root-owned, resource-limited timer reads fixed service log paths every
  ten seconds and copies only selected fields. Alloy has no Docker socket access,
  Docker group membership or raw service-log permissions. App command/room IDs
  remain JSON fields, never metric or Loki labels.
- PostgreSQL and Redis initially export **severity-only** log records. These show
  when errors/warnings occurred, not their original SQL, commands or diagnostic
  messages. Investigate full details through privileged SSH when needed.
- Nginx access logs, arbitrary system logs, SQL statements, game payloads, chat,
  third-party tracebacks and tokens are not uploaded. App non-JSON lines are dropped.
- Log collection is best effort: first encounter of a file starts at EOF (including
  container recreation and rotation), so startup/rotation boundary records can be
  missed. Partial lines wait for completion; oversized lines discard the current
  remainder. Logs may duplicate across a bridge crash after append/before cursor
  persistence. Local sanitized files are bounded to about 15 MiB; long outages can
  lose old logs. This is not an audit trail or accounting source.
- Grafana Free usage is not guaranteed by scrape intervals. Check active series and
  ingestion in the Cloud usage dashboard after traffic starts. Unique runtime IDs
  are excluded from metric labels. No paid-plan change is performed here.
- CPU cap 25% of one core, memory high 384 MiB/max 512 MiB per Alloy process are
  initial bounds, not measured usage. Tune based on actual health/backlog.

## Verify after apply

On every server, `systemctl is-active alloy bhidne-monitoring-logs.timer` should
report active. `curl -fsS http://127.0.0.1:12345/-/ready` checks the collector only;
it does **not** prove remote ingestion. Use localhost `/metrics` to inspect remote
write failures/retries, and `systemctl status bhidne-monitoring-logs.service` for
bridge failures. Do not copy credentials or unfiltered logs into shared reports.

`verify.py` can be piped to `python3 - ROLE` over your verified SSH connection
(`ROLE` is `apps`, `postgres` or `redis`). It prints only health and upload
counters. Its optional `--log-probe` appends a harmless monitoring diagnostic;
check that Loki sent-entry counters increase afterward.

In Grafana Explore, use the existing Cloud Prometheus data source:

```promql
up{environment="production"}
pg_up{environment="production"}
redis_up{environment="production"}
redis_exporter_last_scrape_error{environment="production"}
sum by (instance) (bhidne_websocket_connections{environment="production"})
histogram_quantile(0.95, sum by (le, operation) (rate(bhidne_operation_seconds_bucket{environment="production"}[5m])))
```

Expect four `bhidne-host`, four `bhidne-alloy`, two `bhidne-runtime`, one
`bhidne-postgres` and one `bhidne-redis` targets, `pg_up=1`, `redis_up=1` and no
Redis scrape error. A scrape target's `up=1` alone does not prove its DB is healthy.
Missing targets must be checked as well as targets reporting zero.

For Cloud Loki, generate normal gameplay activity after installation, then query:

```logql
{environment="production", job="bhidne-apps"} | json
{environment="production", job="bhidne-apps"} | json | command_id="YOUR_COMMAND_ID"
{environment="production", job=~"bhidne-postgres|bhidne-redis"} | json
```

Quiet databases may produce no new logs. Do not force a database failure just to
populate a panel. Import `dashboard.json` under Dashboards → New → Import and
select the stack's metrics/logs data sources. Client end-to-end latency still
requires the planned load-test measurements; server histograms are not that SLA.

## Stop / rotate credentials

To stop collection on a server, stop and disable `alloy` and
`bhidne-monitoring-logs.timer`. App/DB/cache services stay running. Monitoring
accounts and local buffers remain for an explicit cleanup; don't delete them as a
side effect of stopping ingestion. To rotate Cloud credentials, rerun the hidden
prompt then the playbook; revoke the old token after successful ingestion.

Reference: [Grafana Alloy installation](https://grafana.com/docs/alloy/latest/set-up/install/linux/),
[PostgreSQL exporter](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.postgres/),
[Redis exporter](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.redis/).

## Initial production verification (2026-09-28)

Installed on all four hosts. Both service exporters reported healthy (`pg_up=1`,
`redis_up=1`) with zero scrape errors. All four collectors reported successful
metric/log uploads, zero retries/failures, empty metric queues, and no dropped log
entries at the final check. Synthetic monitoring logs verified each log pipeline.
Alloy RSS was about 226–240 MiB per host. The public API remained healthy.

The final PostgreSQL URL intentionally has no hostname in its authority: the Unix
socket is supplied only in the query string. Specifying localhost there caused
TCP/password authentication with this exporter, despite the socket query argument.
The playbook now verifies DB/cache exporter health as well as collector readiness.

The dashboard file is prepared but has not been imported or visually verified in
Grafana. Alert destinations and load testing remain separate follow-up work.
