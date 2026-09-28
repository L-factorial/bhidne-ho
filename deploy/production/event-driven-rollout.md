# Event-driven UI rollout

This change includes additive database migration 26 and new constrained release
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

Migration 26 preserves existing data but the previous image's strict schema check
rejects version 26 if that old image is restarted. Consequently an application
failure after migration requires a forward fix with a schema-26-compatible image;
do not rely on restarting the pre-migration image as a rollback. Retain a verified
database backup and the old release digest before undertaking this schema rollout.
No database downgrade or destructive rollback is automated.

After rollout, check both revisions, public health, public/private lobby changes,
two-player Flush updates, leave/end/reconnect behavior, and browser request counts.
The slow reconciliation interval is 30 seconds; WebSocket heartbeats are unchanged.
