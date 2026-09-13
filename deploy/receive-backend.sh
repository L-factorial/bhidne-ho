#!/usr/bin/env bash
# Installed by an administrator at /usr/local/sbin/bhidne-ho-deploy.
# The Actions SSH key is restricted to this command (no interactive shell/forwarding).
set -euo pipefail
exec 9>/var/lock/bhidne-ho-deploy.lock
flock -w 600 9
release=$(mktemp -d /opt/bhidne-ho-test/release-XXXXXXXX)
trap 'rm -f "$release/upload.tar.gz"' EXIT
cat > "$release/upload.tar.gz"
python3 - "$release" <<'PY'
import pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
allowed = {'Dockerfile', 'pyproject.toml', 'app', 'card_utils', 'callbreak', 'marriage', 'flush', 'deploy', '.dockerignore'}
with tarfile.open(root / 'upload.tar.gz', 'r:gz') as archive:
    members = archive.getmembers()
    for item in members:
        path = pathlib.PurePosixPath(item.name)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in allowed:
            raise ValueError('Unexpected archive path')
        if not (item.isfile() or item.isdir()):
            raise ValueError('Archive links and special files are not allowed')
    archive.extractall(root, members=members, filter='data')
PY
cd "$release"
image=bhidne-ho-test-backend
previous=false
if docker image inspect "$image:latest" >/dev/null 2>&1; then
  docker tag "$image:latest" "$image:previous"
  previous=true
fi
docker compose -p bhidne-ho-test -f deploy/compose.yaml build backend
if ! docker compose -p bhidne-ho-test -f deploy/compose.yaml up -d --no-build --wait --wait-timeout 90; then
  if "$previous"; then
    docker tag "$image:previous" "$image:latest"
    docker compose -p bhidne-ho-test -f deploy/compose.yaml up -d --no-build --wait --wait-timeout 90
  fi
  exit 1
fi
curl --fail --silent --show-error http://127.0.0.1:18080/health
ln -sfn "$release" /opt/bhidne-ho-test/current
