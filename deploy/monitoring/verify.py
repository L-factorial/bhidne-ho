#!/usr/bin/env python3
"""Run on a monitored host. Prints health/counters, never credentials or raw logs."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import urllib.request


def get(path):
    with urllib.request.urlopen('http://127.0.0.1:12345' + path, timeout=15) as response:
        return response.read().decode()


def select(text, names):
    result = {}
    for line in text.splitlines():
        if line.startswith('#') or not line:
            continue
        name = re.split(r'[{\s]', line)[0]
        if name in names:
            result[name] = result.get(name, 0) + float(line.rsplit(' ', 1)[1])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('role', choices=['apps', 'postgres', 'redis'])
    parser.add_argument('--log-probe', action='store_true')
    args = parser.parse_args()
    health = {}
    for unit in ['alloy', 'bhidne-monitoring-logs.timer']:
        health[unit] = subprocess.run(['systemctl', 'is-active', unit], capture_output=True, text=True).stdout.strip()
    health['ready'] = get('/-/ready').strip()
    metrics = get('/metrics')
    names = {'prometheus_remote_storage_samples_total', 'prometheus_remote_storage_samples_pending',
             'prometheus_remote_storage_samples_failed_total', 'prometheus_remote_storage_samples_retried_total',
             'prometheus_remote_storage_succeeded_samples_total', 'loki_write_sent_entries_total',
             'loki_write_dropped_entries_total', 'loki_write_batch_retries_total',
             'process_resident_memory_bytes'}
    health['collector'] = select(metrics, names)
    host_metrics = get('/api/v0/component/prometheus.exporter.unix.host/metrics')
    health['host_series'] = sum(bool(line) and not line.startswith('#') for line in host_metrics.splitlines())
    if args.role == 'apps':
        with urllib.request.urlopen('http://127.0.0.1:9108/metrics', timeout=10) as response:
            runtime = response.read().decode()
        health['runtime_series'] = sum(bool(line) and not line.startswith('#') for line in runtime.splitlines())
    if args.role in ('postgres', 'redis'):
        component = 'prometheus.exporter.postgres.database' if args.role == 'postgres' else 'prometheus.exporter.redis.cache'
        health['exporter'] = select(get('/api/v0/component/' + component + '/metrics'),
                                    {'pg_up', 'pg_exporter_last_scrape_error', 'redis_up', 'redis_exporter_last_scrape_error'})
    if args.log_probe:
        with Path('/var/log/bhidne-monitoring/events.jsonl').open('a') as output:
            output.write(json.dumps({'event': 'monitoring_ingestion_probe', 'level': 'info'}) + '\n')
        health['log_probe'] = 'queued; verify sent entries increased on the next check'
    print(json.dumps(health, indent=2))


if __name__ == '__main__':
    main()
