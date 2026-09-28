# Production branch deployments

Pushes to `bhidne-ho-scalability-prod` run `.github/workflows/backend-production.yml`.
The workflow tests the backend with PostgreSQL 17, Redis, nginx and PGlite, builds
one image, publishes it to private GHCR, then deploys the exact digest to app1
and app2 sequentially. Their addresses come from GitHub production-environment
variables `BHIDNE_PROD_APP1_HOST` and `BHIDNE_PROD_APP2_HOST`. It ends with a public
HTTPS health check at `api.prod.bhidne-ho.lfactorial.com`. Deployments are serialized
and running rollouts are not canceled by a later push. Manual dispatch is supported
on this branch. `main` retains its existing testing workflow.

The GitHub `production` environment has been created and restricted to this branch.
Its two app-host variables are set to the replacement IPs. All four replacement
SSH host keys and VPC addresses are verified. PostgreSQL/Redis host firewalls are
configured. Native PostgreSQL 17.11 and Redis 7.0.15 are installed and authenticated
checks pass. Both app hosts can reach the private services; public service ports
and cross-database-host access are blocked. An unchanged provisioning rerun made
zero changes. Database credentials remain in encrypted local inputs.
Application VMs, DNS and load balancing remain unconfigured. Local uncommitted files are not deployed:
only code committed and pushed to this branch reaches GitHub Actions.

## Production frontend and domains

The existing main-only `.github/workflows/pages.yml` publishes the frontend at
`https://bhidne-ho.lfactorial.com` with
`EXPO_PUBLIC_API_URL=https://api-bhidne-ho.lfactorial.com`.
The production backend target remains `https://api.prod.bhidne-ho.lfactorial.com`.
Frontend runtime selection is build-time: `EXPO_PUBLIC_RUNTIME_MODE=distributed-integration`
selects the existing distributed client; other builds use the previous client.

The scalability frontend will use Cloudflare Pages from `bhidne-ho-scalability-prod`
at `https://prod.bhidne-ho.lfactorial.com`, matching the provisioning `client_origin`.
Use [the Cloudflare setup guide](cloudflare-pages.md) for the repository build
command, Git connection, branch controls and DNS steps. The existing main GitHub
Pages deployment remains separate. Cloudflare account setup is still pending.

The API hostname must resolve to the backend load balancer, with TLS and WebSocket
forwarding to the private application listeners. Load-balancer/DNS configuration
and the actual production application release remain pending.

## Access and secrets

- Use an administrator SSH key for initial provisioning. Verify VM ED25519 host
  fingerprints from the DigitalOcean console with
  `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Compare scanned keys to those
  fingerprints before enrolling them; `ssh-keyscan` alone does not establish trust.
- Generate a **separate** ED25519 key for GitHub deployment. Install only its public
  key through `apps.yml`. Its authorized-key entry uses `restrict` plus a forced
  root-owned receiver; shells, forwarding and PTYs are disabled. It accepts only
  `check sha256:<64 hex>` or `deploy sha256:<64 hex>` for the fixed production image
  repository. Ordinary pushes cannot replace the receiver or host configuration.
- Create a GitHub environment named `production`, restricted to
  `bhidne-ho-scalability-prod`. Store `BHIDNE_PROD_DEPLOY_SSH_KEY` and
  `BHIDNE_PROD_KNOWN_HOSTS` there. The latter contains verified known-hosts lines for
  both replacement application public IPs. Set the two host variables above to
  those IPs. The previous droplets were destroyed; their addresses must not be reused
  as deployment targets. Do not reuse the testing deployment key.
- GHA publishes using its temporary `GITHUB_TOKEN` with `packages: write`.
  The deployment job has only `packages: read`; it sends its short-lived token
  over SSH stdin for each release command. The receiver authenticates using a
  root-private temporary Docker configuration and removes it on normal exit. No
  permanent registry token is provisioned on the VMs. Confirm the package remains
  private, linked to this repository, and accessible to this workflow.
- Application passwords and signalling secrets are held in encrypted Ansible
  inputs and root-only `/etc/bhidne-prod/runtime.env`. GitHub does not receive them.
  The generated deployment key is separate from the administrator login key. Containers run
  as UID 10001 with read-only root filesystems, no capabilities or host volumes,
  no-new-privileges, memory/PID limits, and rotated logs.
- Anyone allowed to push deployable application code can cause that code to read
  application secrets and data. Protect branch write access and review changes to
  the workflow. The SSH restriction narrows host access; it is not a sandbox for
  untrusted repository contributors.

## Prepare infrastructure once

1. Fill the ignored inventory with all four VPC addresses and the real frontend
   HTTPS origin. Supply per-host `ansible_ssh_private_key_file` if PostgreSQL uses
   a different administrator key. See [service provisioning](../deploy/provision/README.md).
2. Set firewall rules before enabling the readiness booleans in inventory:
   PostgreSQL 5432 and Redis 6379 from app private IPs only; private app 8080 from
   the load balancer and peer app hosts only. SSH needs verified administrator and
   CI access. GitHub-hosted runner egress is not a single fixed IP: select suitable
   firewall rules or a runner with controlled egress for your policy. This work
   does not configure a cloud firewall or create a runner. Native database hosts
   can use the included `service-firewall.yml` UFW playbook before service setup.
3. Provision PostgreSQL and Redis using `run.sh preflight`, then `run.sh apply`.
   Validate on disposable Ubuntu hosts and check an unchanged rerun first. The
   services are native systemd services; application pushes never upgrade them.
4. With the provisioning venv activated, provision app hosts:

   ```sh
   ANSIBLE_COLLECTIONS_PATH=deploy/provision/collections ansible-playbook \
     -i deploy/provision/inventory.local.yml deploy/provision/apps.yml \
     -e @deploy/provision/secrets.local.yml --ask-vault-pass
   ```

   This installs Docker if absent, installs the receiver, configures protected
   runtime files and deployment key, and checks service ports from both app hosts.
   It does not start the application or initialize the database. Use dedicated
   application hosts; existing Docker workloads are not modified by this playbook.
5. Configure a load balancer for the two private app addresses, HTTP port 8080,
   `/health` checks, WebSocket support and appropriate idle timeouts. Configure DNS
   and TLS for `api.prod.bhidne-ho.lfactorial.com`. Metrics bind only to host
   loopback at 9108. No affinity is required; sockets reconnect after replacement.
6. Configure GitHub environment secrets and package permissions. Make the initial
   push to build/publish a tested image. A deployment against an uninitialized
   database will deliberately fail preflight without replacing an app.
7. **Once, for a confirmed empty database**, use the tested image digest from that
   build on app1 through an administrator session:

   ```sh
   # Run as root on app1; substitute the exact published digest.
   image=ghcr.io/l-factorial/bhidne-ho-backend-prod@sha256:REPLACE_DIGEST
   # The initial workflow check already pulled this image before rejecting the empty DB.
   docker image inspect "$image" --format '{{.Id}}'
   docker run --rm --user 10001:10001 --read-only --cap-drop ALL \
     --security-opt no-new-privileges:true --pids-limit 256 --memory 2g \
     --tmpfs /tmp:rw,noexec,nosuid,size=64m \
     --env-file /etc/bhidne-prod/runtime.env \
     "$image" python -m app.durable_games.bootstrap initialize
   ```

   The initializer refuses an existing public schema. Never run it as a migration
   or on the legacy dataset. Then rerun the failed deployment job for that exact
   workflow run, retaining the already-built digest.
8. Verify login, game commands and WebSocket reconnect/recovery through HTTPS.
   Configure off-server PostgreSQL backups/WAL archiving and prove restore before
   opening the service to users. Password login is available; provider credentials
   and real Google/Facebook callback validation are additional configuration.

## Release behavior and limits

Both hosts first pull the digest and run a disposable, restricted container that
checks runtime settings, exact database schema/marker and authenticated Redis PING.
No application initialization or migrations occur during a release.

Each host then checks its existing application container. An unchanged healthy
image and environment are a no-op; otherwise an existing app requires a healthy
peer before it is stopped. The receiver allows 60 seconds for Docker shutdown and 30 seconds for
Uvicorn's request shutdown, retains the previous container, starts the new image,
and waits for `/health`. Failed replacements restore and check the previous
container. Preflight failures leave the existing container untouched. The receiver
labels containers with a hash of the protected runtime environment.
After configuration changes made by Ansible, redeploying even the same digest
replaces the container with the updated environment. Credential rotation still
requires coordination with PostgreSQL/Redis and the peer application.

This is a sequential restart, not a promise of zero downtime: the load balancer
must stop routing to unhealthy targets, active sockets can reconnect, and room
ownership recovery may take its lease interval. The receiver does not currently
call a provider load-balancer drain API. `/health` reports runtime lifecycle; it
is not a continuous comprehensive PostgreSQL/Redis availability probe.

If app2 fails after app1 succeeds, app2 restores its previous container and the
workflow fails; app1 stays on the new version. There is no automatic whole-fleet
rollback or database rollback. Only deploy mutually compatible application versions
this way. Schema-changing releases need a separate migration/maintenance plan;
exact-schema checks will reject incompatible images before stopping existing apps.
A failed final public health check requires investigation, not automatic rollback.
An SSH disconnect can leave the receiver finishing its locked operation; inspect the
host and retry the same digest to reconcile, rather than assuming it rolled back.

The runtime is still the reviewed `app.durable_games.bootstrap` entrypoint. This
host deployment explicitly sets `BHIDNE_DISTRIBUTED_ISOLATED=1` for a new dedicated
`bhidne_distributed_prod` database and a production Redis namespace; it preserves
its `distributed-integration-v1` marker and native protocol. The health runtime
name and compatible frontend mode remain `distributed-integration`. This is not a
conversion of legacy users/games and does not establish outstanding native-device,
provider, HA or capacity release claims. Pair it with the compatible client and
validate those release requirements before public cutover.

The app-host playbook owns `/etc/bhidne-prod/runtime.env`. It currently supplies
password-auth/distributed settings only; do not add provider secrets manually and
expect them to survive reprovisioning. Add reviewed provider configuration to that
template as part of the authentication setup before enabling provider login.

## Verification and recovery

```sh
.venv/bin/python -m pytest tests/test_production_release.py -q
```

Local receiver tests mock Docker/network operations and exercise command validation,
preflight failures, unhealthy-peer refusal, unchanged-image behavior and rollback.
They do not prove actual Ubuntu/container execution. Validate that path on disposable
hosts, including a failed candidate and a second unchanged provisioning/deploy run.
On the host, administrators can use `docker ps`, protected `docker inspect`, and
`docker logs bhidne-prod-app` to investigate; never paste raw inspection output
because it contains environment secrets. The receiver intentionally suppresses
subprocess error output to keep CI logs free of credentials.
