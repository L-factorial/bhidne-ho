"""Exercise real Ansible assertions locally; never execute provisioning tasks.

Run in the provisioning venv: python -m unittest discover -s deploy/provision/tests
"""
import copy
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('provision_filter', ROOT / 'filter_plugins/provision.py')
filters = importlib.util.module_from_spec(spec)
spec.loader.exec_module(filters)


class PrivateNetworkTests(unittest.TestCase):
    def test_only_rfc1918_ipv4_addresses_are_accepted(self):
        for value in ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.5']:
            with self.subTest(value=value):
                self.assertTrue(filters.private_ipv4(value))
        for value in ['127.0.0.1', '0.0.0.0', '169.254.1.1', '172.32.0.1',
                      '159.223.88.151', '10.999.1.1', '10.0.0.1/24', '::1',
                      'fc00::1', 'REPLACE_PRIVATE_IP', None, 167772161, '10.0.0.1\nport 1']:
            with self.subTest(value=value):
                self.assertFalse(filters.private_ipv4(value))


@unittest.skipUnless(shutil.which('ansible-playbook'), 'provisioning Ansible environment required')
class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tasks = yaml.safe_load((ROOT / 'services.yml').read_text())[0]['tasks']
        self.tasks += yaml.safe_load((ROOT / 'apps.yml').read_text())[0]['pre_tasks']

    def run_guard(self, name, variables, succeeds):
        task = copy.deepcopy(next(task for task in self.tasks if task['name'] == name))
        # Test the guard body for the state in question, without filesystem probes.
        task.pop('when', None)
        task.pop('no_log', None)  # All inputs below are synthetic fixture values.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            variables = copy.deepcopy(variables)
            groups = variables.pop('groups', {})
            hostvars = variables.pop('hostvars', {})
            inventory = {'all': {'hosts': {'localhost': {}}, 'children': {
                group: {'hosts': {host: hostvars.get(host, {}) for host in hosts}}
                for group, hosts in groups.items()
            }}}
            (root / 'inventory.yml').write_text(yaml.safe_dump(inventory))
            play = [{'hosts': 'localhost', 'gather_facts': False, 'vars': variables,
                     'tasks': [task]}]
            (root / 'test.yml').write_text(yaml.safe_dump(play))
            env = dict(os.environ, ANSIBLE_HOME=str(root / 'ansible'),
                       ANSIBLE_LOCAL_TEMP=str(root / 'tmp'),
                       ANSIBLE_FILTER_PLUGINS=str(ROOT / 'filter_plugins'),
                       ANSIBLE_NOCOLOR='1')
            result = subprocess.run(
                ['ansible-playbook', '-i', str(root / 'inventory.yml'), '-c', 'local', str(root / 'test.yml')],
                env=env, text=True, capture_output=True, timeout=30,
            )
            self.assertEqual(result.returncode == 0, succeeds, result.stdout + result.stderr)
            if not succeeds:
                self.assertIn('"evaluated_to": false', result.stdout)

    def test_fresh_host_and_unmanaged_installation_refusal(self):
        baseline = {'ansible_facts': {'packages': {}},
                    'unmanaged_listeners': {'stdout': ''},
                    'service_directories': {'results': [{'stat': {'exists': False}}]}}
        name = 'Refuse to adopt unmanaged database installations'
        self.run_guard(name, baseline, True)
        for key, value in [
            ('ansible_facts', {'packages': {'postgresql-16': []}}),
            ('ansible_facts', {'packages': {'redis-server': []}}),
            ('unmanaged_listeners', {'stdout': 'LISTEN 0 4096 0.0.0.0:5432'}),
            ('service_directories', {'results': [{'stat': {'exists': True}}]}),
        ]:
            with self.subTest(key=key, value=value):
                self.run_guard(name, {**baseline, key: value}, False)

    def test_cluster_version_port_and_multiple_cluster_refusal(self):
        name = 'Require exactly the managed PostgreSQL 17 main cluster'
        for output, accepted in [
            ('17 main 5432 online postgres /data /log', True),
            ('16 main 5432 online postgres /data /log', False),
            ('17 main 5433 online postgres /data /log', False),
            ('17 main 5432 online\n17 other 5433 online', False),
            ('', False),
        ]:
            with self.subTest(output=output):
                self.run_guard(name, {'existing_clusters': {'stdout': output,
                               'stdout_lines': output.splitlines()}}, accepted)

    def test_network_preflight_accepts_only_explicit_host_bound_private_configuration(self):
        name = 'Require separate Ubuntu 24.04 hosts and explicit private networking'
        baseline = {
            'groups': {'postgres': ['pg'], 'redis': ['redis']},
            'hostvars': {'pg': {'ansible_host': '168.144.241.116'},
                         'redis': {'ansible_host': '159.223.88.151'}},
            'ansible_facts': {'distribution': 'Ubuntu', 'distribution_version': '24.04',
                              'all_ipv4_addresses': ['10.0.0.2']},
            'private_ip': '10.0.0.2', 'app_private_ips': ['10.0.0.3', '10.0.0.4'],
            'private_firewall_ready': True,
        }
        self.run_guard(name, baseline, True)
        for key, value in [('private_firewall_ready', False),
                           ('private_ip', '10.0.0.99'),
                           ('app_private_ips', ['10.0.0.3', '8.8.8.8']),
                           ('app_private_ips', ['10.0.0.3', '10.0.0.3'])]:
            with self.subTest(key=key, value=value):
                self.run_guard(name, {**baseline, key: value}, False)


    def test_secret_validation_rejects_duplicates_and_line_breaks(self):
        values = {'postgres_password': 'a' * 64, 'redis_password': 'b' * 64}
        name = 'Require independent URL-safe secrets'
        self.run_guard(name, values, True)
        self.run_guard(name, values | {'redis_password': 'a' * 64}, False)
        self.run_guard(name, values | {'redis_password': 'b' * 64 + '\n'}, False)
        values |= {'signal_secret': 'c' * 64}
        self.run_guard('Validate runtime secrets', values, True)
        self.run_guard('Validate runtime secrets', values | {'signal_secret': 'a' * 64}, False)


if __name__ == '__main__':
    unittest.main()
