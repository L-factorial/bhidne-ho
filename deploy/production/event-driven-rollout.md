# Event-driven UI rollout

This change includes additive database migrations 26–27 and new constrained release
phases. Nothing is automatically installed on the existing VMs by editing this
repository.

Before pushing this branch, update the release receiver on both app hosts using
your existing administrative SSH access and verified host keys:

```sh
ANSIBLE_HOST_KEY_CHECKING=True ansible-playbook \
  -i deploy/provision/inventory.local.yml deploy/provision/release-receiver.yml
```

This playbook only replaces the root-owned release receiver. It does not restart
services or deploy an application. Without it, the current receiver rejects the
new workflow phases before changing the database or application.

The workflow then performs these phases with the tested image digest:

1. Explicitly migrate the marked distributed dataset, under its migration lock.
2. Check both hosts against the new schema and dependencies.
3. Replace both backends sequentially while retaining the previous frontends.
4. Activate the new frontend on both hosts only after both backends succeed.

Migration is idempotent, transactionally applies pending DDL, requires a contiguous
supported migration history, and refuses legacy/unmarked datasets. Application
startup and ordinary `check` remain read-only schema verification.

Migrations 26–27 preserve existing data but previous images' strict schema checks
reject the newer version if those images are restarted. Consequently an application
failure after migration requires a forward fix with a schema-27-compatible image;
do not rely on restarting the pre-migration image as a rollback. Retain a verified
database backup and the old release digest before undertaking this schema rollout.
No database downgrade or destructive rollback is automated.

After rollout, check both revisions, public health, public/private lobby changes,
two-player Flush updates, leave/end/reconnect behavior, and browser request counts.
The slow reconciliation interval is 30 seconds; WebSocket heartbeats are unchanged.

Migration 27 adds seven indexes for exact case-insensitive directory lookup,
friendship lists, pending room invitations, and settlements. It does not change
tables, columns, constraints, or existing records and requires no extension.
The directory retains exact matching; substring search is not enabled by this
change. The same release batches lobby members and settlement children.

The migration runner is transactional, so these index builds use regular
`CREATE INDEX`, not `CONCURRENTLY`. Builds can block writes to the indexed
tables until the migration commits. Schedule a maintenance window and assess
table sizes before rollout; the local 20,000-account test is not a production
build-time estimate. Startup will require version 27 after this release.

After migrating, refresh planner statistics with `ANALYZE` on
`user_profiles`, `account_credentials`, `friendships`, `room_invitations`,
`settlement_batches`, and `settlement_transfers`. Verify index use with
`EXPLAIN (ANALYZE, BUFFERS)` on representative reads and compare query latency,
pool wait time, and command latency during the target load test.
