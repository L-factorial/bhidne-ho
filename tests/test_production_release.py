"""Release receiver safety and failure recovery, with Docker/network boundaries mocked."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest

spec = importlib.util.spec_from_file_location('production_release', Path(__file__).parents[1] / 'deploy/production/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
DIGEST = 'sha256:' + 'a' * 64
CONFIG = {'repository': 'ghcr.io/l-factorial/bhidne-ho-backend-prod',
          'private_ip': '10.0.0.2', 'peer_ip': '10.0.0.3'}
OLD = {'Config': {'Image': 'previous-image', 'Labels': {'com.bhidne.managed': 'production'}}}


@pytest.mark.parametrize('ssh_command', ['deploy latest', 'deploy sha256:' + 'a' * 63,
                                    'deploy ' + DIGEST + '; id', 'initialize ' + DIGEST,
                                    'deploy ' + DIGEST + '\n', 'check other/repo@' + DIGEST])
def test_rejects_arbitrary_ssh_commands(ssh_command):
    with pytest.raises(ValueError):
        release.parse_request(ssh_command)


def test_accepts_only_exact_digest_requests():
    assert release.parse_request('deploy ' + DIGEST) == ('deploy', DIGEST)
    assert release.parse_request('check ' + DIGEST) == ('check', DIGEST)


@pytest.mark.parametrize('change', [{'private_ip': '0.0.0.0'}, {'peer_ip': '8.8.8.8'},
                                  {'peer_ip': '10.0.0.2'}, {'repository': 'ghcr.io/x/y;id'}])
def test_rejects_invalid_host_configuration(change):
    with pytest.raises(ValueError):
        release.validate_config(CONFIG | change)


def boundaries(monkeypatch, containers):
    monkeypatch.setattr(release, 'environment_revision', lambda: 'environment-v1')
    command = Mock()
    monkeypatch.setattr(release, 'command', command)
    monkeypatch.setattr(release, 'inspect_container', Mock(side_effect=containers))
    monkeypatch.setattr(release, 'health', Mock(return_value=True))
    ready = Mock()
    monkeypatch.setattr(release, 'wait_ready', ready)
    return command, ready


def test_failed_dependency_check_never_stops_existing_container(monkeypatch):
    command, _ = boundaries(monkeypatch, [])
    command.side_effect = [None, RuntimeError('schema mismatch')]
    with pytest.raises(RuntimeError):
        release.release(CONFIG, 'deploy', DIGEST)
    assert not any(call.args[1] in ('stop', 'rm', 'rename') for call in command.call_args_list)


def test_check_never_replaces_running_application(monkeypatch):
    command, ready = boundaries(monkeypatch, [])
    release.release(CONFIG, 'check', DIGEST)
    assert command.call_count == 2
    assert command.call_args_list[1].args[1:3] == ('run', '--rm')
    assert '--read-only' in command.call_args_list[1].args
    ready.assert_not_called()


def test_failed_candidate_restores_original_container(monkeypatch):
    command, ready = boundaries(monkeypatch, [OLD, None, {'Config': {}}])
    ready.side_effect = [RuntimeError('unhealthy'), None]
    with pytest.raises(RuntimeError, match='unhealthy'):
        release.release(CONFIG, 'deploy', DIGEST)
    calls = [call.args for call in command.call_args_list]
    assert ('docker', 'rename', release.CONTAINER, release.PREVIOUS) in calls
    assert calls[-3:] == [('docker', 'rm', '-f', release.CONTAINER),
                         ('docker', 'rename', release.PREVIOUS, release.CONTAINER),
                         ('docker', 'start', release.CONTAINER)]
    assert ready.call_count == 2


def test_unhealthy_peer_prevents_replacement(monkeypatch):
    command, _ = boundaries(monkeypatch, [OLD])
    monkeypatch.setattr(release, 'health', lambda _: False)
    with pytest.raises(RuntimeError, match='Peer'):
        release.release(CONFIG, 'deploy', DIGEST)
    assert command.call_count == 2


def test_already_healthy_digest_does_not_restart(monkeypatch):
    old = {'Config': {'Image': CONFIG['repository'] + '@' + DIGEST,
                      'Labels': {'com.bhidne.managed': 'production',
                                 'com.bhidne.environment': 'environment-v1'}}}
    command, ready = boundaries(monkeypatch, [old])
    release.release(CONFIG, 'deploy', DIGEST)
    assert command.call_count == 2
    ready.assert_not_called()


def test_first_deploy_uses_private_ports_and_container_restrictions(monkeypatch):
    command, ready = boundaries(monkeypatch, [None, None])
    release.release(CONFIG, 'deploy', DIGEST)
    run = command.call_args.args
    assert run[:3] == ('docker', 'run', '-d')
    assert '10.0.0.2:8080:8080' in run
    assert '127.0.0.1:9108:9108' in run
    assert run[run.index('--user') + 1] == '10001:10001'
    assert run[run.index('--cap-drop') + 1] == 'ALL'
    assert '--read-only' in run
    assert 'no-new-privileges:true' in run
    ready.assert_called_once_with('10.0.0.2')


def test_unmanaged_container_is_not_replaced(monkeypatch):
    command, _ = boundaries(monkeypatch, [{'Config': {'Image': 'other', 'Labels': {}}}])
    with pytest.raises(RuntimeError, match='unmanaged'):
        release.release(CONFIG, 'deploy', DIGEST)
    assert command.call_count == 2


def test_same_image_with_changed_environment_is_replaced(monkeypatch):
    old = {'Config': {'Image': CONFIG['repository'] + '@' + DIGEST,
                      'Labels': {'com.bhidne.managed': 'production',
                                 'com.bhidne.environment': 'old-environment'}}}
    command, ready = boundaries(monkeypatch, [old, None])
    release.release(CONFIG, 'deploy', DIGEST)
    assert any(call.args[1] == 'stop' for call in command.call_args_list)
    assert 'com.bhidne.environment=environment-v1' in command.call_args.args
    ready.assert_called_once()


@pytest.mark.parametrize('payload', ['{}', 'null', '[]', '{"username":"user","token":"short"}',
                                    '{"username":"user","token":"a token with white space is invalid"}',
                                    'x' * 16385])
def test_rejects_invalid_registry_credentials(payload):
    with pytest.raises(ValueError):
        release.registry_credentials(payload)


@pytest.mark.parametrize('login_succeeds', [True, False])
def test_registry_credentials_are_temporary_and_not_logged(monkeypatch, tmp_path, login_succeeds):
    import io
    import json
    import os
    from types import SimpleNamespace

    config = tmp_path / 'release.json'
    config.write_text(json.dumps(CONFIG))
    monkeypatch.setattr(release, 'CONFIG', config)
    monkeypatch.setattr(release.os, 'geteuid', lambda: 0)
    monkeypatch.setattr(release.signal, 'signal', lambda *_: None)
    monkeypatch.setattr(release.sys, 'stdin', io.StringIO(json.dumps({'username': 'github-user', 'token': 't' * 30})))
    monkeypatch.setenv('SSH_ORIGINAL_COMMAND', 'check ' + DIGEST)
    monkeypatch.setenv('PATH', os.environ['PATH'])
    monkeypatch.setenv('DOCKER_CONFIG', 'previous-config')
    for name in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
        monkeypatch.delenv(name, raising=False)
    directories = []

    def login(*args, **kwargs):
        directory = Path(os.environ['DOCKER_CONFIG'])
        directories.append(directory)
        assert directory.parent == tmp_path
        assert kwargs['input'] == 't' * 30
        assert kwargs['capture_output'] is True
        (directory / 'config.json').write_text('synthetic credentials')
        return SimpleNamespace(returncode=0 if login_succeeds else 1)

    monkeypatch.setattr(release.subprocess, 'run', login)
    deployed = Mock()
    monkeypatch.setattr(release, 'release', deployed)
    if login_succeeds:
        release.main()
        deployed.assert_called_once_with(CONFIG, 'check', DIGEST)
    else:
        with pytest.raises(RuntimeError, match='Registry authentication'):
            release.main()
        deployed.assert_not_called()
    assert directories and not directories[0].exists()
