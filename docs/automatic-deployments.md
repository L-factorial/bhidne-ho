# Automatic testing deployments

Every push to `main` starts two GitHub Actions workflows, with no path filters:

- **Deploy frontend**: type-check, export Expo with the hosted API URL, upload `client/dist`, deploy GitHub Pages at `bhidne-ho.lfactorial.com`.
- **Deploy backend**: run the Python tests, upload backend source over SSH, build the Docker backend target on the existing Droplet, and wait for a healthy container at `api-bhidne-ho.lfactorial.com`.

Both also support manual dispatch from `main`. Deployment concurrency is serialized per target; GitHub may replace an older queued run with a newer pending push. A running deployment is not canceled.

## Droplet access

The repository secrets `BHIDNE_DEPLOY_SSH_KEY` and `BHIDNE_DEPLOY_KNOWN_HOSTS` contain a dedicated key and the previously verified host key. This is not the developer's personal SSH key.

The key's root authorized_keys entry uses `restrict,command="/usr/local/sbin/bhidne-ho-deploy"`. Interactive shells, PTYs and forwarding are disabled. The root-owned receiver is installed from `deploy/receive-backend.sh`. Changing that receiver requires an administrator; a normal source push does not replace it.

The receiver accepts a backend archive on stdin, rejects links and unexpected paths, serializes deployment with flock, builds a release directory under `/opt/bhidne-ho-test`, and updates only Compose project `bhidne-ho-test` on localhost:18080. It retains a `previous` image and restores it if the new container fails its health check. It does not modify Nginx or soccer-agent. The `current` symlink records the last healthy release.

The approved deployment capability runs as root to control Docker. Protect repository write access and the two deployment secrets accordingly. To revoke it, remove the `bhidne-ho-github-actions` key from the Droplet's authorized_keys and remove the repository secret.

## In-memory consequences

Every backend deployment restarts the game server. Sessions, rooms, profiles, balances and games reset. Deploy between test games; clients with expired sessions should sign out and rejoin. Rollback restores code, not in-memory data. One container and one Uvicorn worker remain mandatory.

Frontend and backend workflows are independent: maintain API compatibility across deployments. Workflow failures appear in the repository Actions tab. Release directories and the previous image are retained for troubleshooting; an administrator can remove old inactive releases after testing.
