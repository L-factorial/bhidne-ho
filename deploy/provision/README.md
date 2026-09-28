# Production PostgreSQL and Redis provisioning

Run this separately from application Git deployments. `run.sh` wraps an Ansible
playbook for two dedicated Ubuntu 24.04 servers. It installs PostgreSQL **17** from
the official PGDG repository and Redis **7** from Ubuntu, managed by systemd.
For the application-host playbook and GitHub push workflow, see
[production deployment](../../docs/production-deployment.md). DNS and load balancing
require the target network details and provider configuration.

## Behavior

- `preflight` gathers facts and checks inputs/existing installations, without
  changing packages, configuration or services. Ansible still uploads temporary
  execution modules over SSH. This is a preflight, not a full simulated installation.
- `apply` repeats preflight, installs missing packages, creates the application
  role and database if absent, and reconciles managed configuration. Existing
  package versions are not deliberately upgraded. Changed service configuration
  triggers a restart; unchanged configuration does not.
- Only fresh dedicated servers and reruns on servers owned by this playbook are
  supported. Existing unmanaged PostgreSQL/Redis packages, configuration or data
  cause a refusal. Adoption, major-version upgrades and migration require separate
  review. Do not bypass this guard by creating a marker on an existing server.
- A root-owned `/etc/bhidne-provision-v1` marker records ownership before package
  installation so interrupted runs can resume. No task removes database data.
- PostgreSQL uses local peer administration and SCRAM application authentication,
  listening on loopback and its exact VPC address. Only the two application IPs
  may remotely access database `bhidne_distributed_prod` as role `bhidne_prod`.
  The role owns this database but has no superuser/create-role/create-db privilege.
- Redis requires a password, binds to loopback and its VPC address, and has a 1 GiB
  data memory limit with `noeviction`, leaving headroom on the 2 GiB host. This is
  an initial setting, not a measured capacity claim. RDB/AOF persistence is disabled:
  this Redis is exclusively for reconstructible distributed-runtime state.
- Password changes are reconciled from the secrets file; coordinate any rotation
  with application configuration. Redis rotation restarts the service. Avoid
  concurrent provisioning runs; use a maintenance window for configuration changes.

## Before applying

1. Confirm both service servers and both app servers use the intended private VPC.
2. Configure a firewall allowing PostgreSQL TCP 5432 / Redis TCP 6379 only from
   the two app private IPs. For dedicated fresh Ubuntu hosts, the repository supplies
   `service-firewall.yml`: it allows SSH on TCP 22 first, permits the appropriate
   service port from the two app IPs to its VPC address, denies other sources on
   that port, and enables default-deny inbound UFW. It refuses existing unmanaged
   UFW rules and never resets them. SSH source restrictions can be layered through
   a cloud firewall; this playbook does not change cloud firewall rules.
3. Verify each SSH host fingerprint through a trusted channel and enroll it in
   your `known_hosts`. Host-key checking remains enabled. SSH needs root or a
   sudo-capable account; use `--ask-become-pass` if needed.
4. Obtain the four private IP addresses. The inventory example records the four replacement public addresses supplied
   by the user; private addresses remain explicit placeholders.

Connections use password authentication over the private VPC; this increment does
not provision TLS for database traffic. Add TLS before enabling clients whose
network policy requires encryption in transit or access beyond that trusted VPC.

## Controller setup and commands

Use Python 3.12+ and an isolated controller environment, from the repository root:

```sh
python3 -m venv deploy/provision/.venv
source deploy/provision/.venv/bin/activate
pip install -r deploy/provision/requirements.txt
ansible-galaxy collection install -r deploy/provision/requirements.yml -p deploy/provision/collections
cp deploy/provision/inventory.example.yml deploy/provision/inventory.local.yml
cp deploy/provision/secrets.example.yml deploy/provision/secrets.local.yml
chmod 600 deploy/provision/secrets.local.yml
```

Edit the local inventory with actual VPC addresses and your SSH user. Set
`private_firewall_ready: true` only after verifying host or cloud firewall rules.
For the repository-managed host firewall, run this before the services preflight:

```sh
ANSIBLE_COLLECTIONS_PATH=deploy/provision/collections ansible-playbook \
  -i deploy/provision/inventory.local.yml deploy/provision/service-firewall.yml
```

 Generate
**two different** secrets using `openssl rand -hex 32`, put them in the local secrets
file, then encrypt it:

```sh
ansible-vault encrypt deploy/provision/secrets.local.yml
deploy/provision/run.sh preflight --ask-vault-pass --private-key /path/to/admin-key
deploy/provision/run.sh apply --ask-vault-pass --private-key /path/to/admin-key
```

The local inventory, secrets, virtual environment and collections are gitignored.
Do not supply passwords in CLI `-e` arguments. Secret-bearing tasks suppress logs
and diffs. Do not run verbose debugging on real credentials.

The apply command verifies a PostgreSQL login/query and authenticated Redis PING
locally on each server. Afterwards, verify connectivity from **both application
hosts** over their private IPs; local checks cannot prove VPC/firewall reachability.
An unchanged second apply should report no service restarts. Validate this on a
disposable Ubuntu pair before the first production run.

## Application handoff

Configure applications with these URL shapes, keeping actual values in protected
runtime environment files:

```text
BHIDNE_DISTRIBUTED_DATABASE_URL=postgresql://bhidne_prod:<postgres_password>@<postgres_private_ip>:5432/bhidne_distributed_prod
BHIDNE_DISTRIBUTED_REDIS_URL=redis://:<redis_password>@<redis_private_ip>:6379/0
```

The playbook creates an empty database; it does **not** run the application
initializer or migrations. The current runtime is still the isolated integration
entrypoint. Its dataset marker and production activation must be addressed in the
separate release increment; provisioning services is not production activation.

Before serving production users, configure off-server PostgreSQL backups with WAL
archiving and verify restore, then complete container/runtime/authentication and
rollout checks. This increment supplies neither replication/HA nor backups, DNS,
HTTPS, exporters, or automatic application rollout. Database and Redis maintenance
must remain separate from routine branch pushes.

## Local validation

With the controller environment activated:

```sh
ANSIBLE_COLLECTIONS_PATH=deploy/provision/collections ansible-playbook -i deploy/provision/inventory.example.yml deploy/provision/services.yml --syntax-check
python -m unittest discover -s deploy/provision/tests -v
bash -n deploy/provision/run.sh
```

These validate playbook syntax and execute only preflight assertions against local
fixtures. They do not prove Ubuntu package installation, service startup or rerun
idempotence; those require the disposable-host check above.

## References

- [Official PostgreSQL Ubuntu repository setup](https://www.postgresql.org/download/linux/ubuntu/)
- [PostgreSQL backup and recovery](https://www.postgresql.org/docs/17/continuous-archiving.html)
- [Redis administration](https://redis.io/docs/latest/operate/oss_and_stack/management/admin/)
- [Redis authentication and network security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/)

The current rollout's generated credentials are encrypted in ignored
`secrets.local.yml`; the generated vault password is in ignored
`.vault-password.local.yml`, both mode 0600. Use
`--vault-password-file deploy/provision/.vault-password.local.yml` from the repository
root, or `.vault-password.local.yml` when using `run.sh` (which changes directory).
Neither file is sent in the Docker build context. Keep a secure backup of both;
possession of both files allows decryption.
