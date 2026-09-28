#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../provision"
export ANSIBLE_HOST_KEY_CHECKING=True
: "${ANSIBLE_LOCAL_TEMP:=/tmp/bhidne-ansible-monitoring}"
export ANSIBLE_LOCAL_TEMP
if [[ ! -f monitoring.local.yml ]]; then
  echo 'First run: python3 deploy/monitoring/configure-secrets.py (from repository root).' >&2
  exit 1
fi
exec "${ANSIBLE_PLAYBOOK:-ansible-playbook}" -i inventory.local.yml monitoring.yml \
  -e @secrets.local.yml -e @monitoring.local.yml "$@"
