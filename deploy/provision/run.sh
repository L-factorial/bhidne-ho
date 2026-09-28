#!/usr/bin/env bash
# Run from any working directory. Dependencies must already be installed.
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in
  preflight) task_args=(--tags preflight) ;;
  apply) task_args=() ;;
  *) echo 'Usage: run.sh preflight|apply [additional ansible-playbook options]' >&2; exit 2 ;;
esac
shift
# Keep host key checking enabled; verify and enroll server keys before using this.
export ANSIBLE_HOST_KEY_CHECKING=True
export ANSIBLE_COLLECTIONS_PATH="${ANSIBLE_COLLECTIONS_PATH:-$PWD/collections}"
exec ansible-playbook -i inventory.local.yml services.yml \
  -e @secrets.local.yml "${task_args[@]}" "$@"
