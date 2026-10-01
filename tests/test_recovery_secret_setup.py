import importlib.util
import json
from pathlib import Path
import stat

import pytest

spec = importlib.util.spec_from_file_location('recovery_setup', Path(__file__).parents[1] / 'deploy/recovery/configure-secrets.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def test_private_production_settings_preserve_queue_key(tmp_path):
    path = tmp_path / 'recovery.local.yml'
    setup.save(path, 're_test_first')
    data = json.loads(path.read_text())['recovery_environment']
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert data['BHIDNE_HO_RECOVERY_PUBLIC_ORIGIN'] == 'https://prod.bhidne-ho.lfactorial.com'
    assert data['BHIDNE_HO_RECOVERY_SMTP_PORT'] == '2587'
    setup.save(path, 're_test_second')
    updated = json.loads(path.read_text())['recovery_environment']
    assert updated['BHIDNE_HO_RECOVERY_KEYS'] == data['BHIDNE_HO_RECOVERY_KEYS']
    assert updated['BHIDNE_HO_RECOVERY_SMTP_PASSWORD'] == 're_test_second'


def test_bad_existing_settings_and_bad_input_do_not_overwrite(tmp_path):
    path = tmp_path / 'recovery.local.yml'
    path.write_text('{"recovery_environment":{}}')
    for token in ['wrong', 're_bad\nkey', 're_valid_test']:
        with pytest.raises((ValueError, KeyError)):
            setup.save(path, token)
        assert path.read_text() == '{"recovery_environment":{}}'

runtime_spec = importlib.util.spec_from_file_location('recovery_runtime_config', Path(__file__).parents[1] / 'deploy/recovery/runtime_config.py')
runtime_config = importlib.util.module_from_spec(runtime_spec)
runtime_spec.loader.exec_module(runtime_config)


def test_runtime_merge_preserves_database_settings_and_is_idempotent(tmp_path):
    local = tmp_path/'recovery.local.yml'
    setup.save(local, 're_example')
    values = json.loads(local.read_text())['recovery_environment']
    runtime = tmp_path/'runtime.env'
    base = '# existing configuration\nBHIDNE_DISTRIBUTED_DATABASE_URL=keep-me\nOTHER_SECRET=literal$value\n'
    runtime.write_text(base)
    assert runtime_config.install(runtime, values)
    assert runtime.read_text().startswith(base)
    assert not runtime_config.install(runtime, values)
    assert stat.S_IMODE(runtime.stat().st_mode) == 0o600
    invalid = {**values,'BHIDNE_HO_RECOVERY_SMTP_PASSWORD':'bad\nINJECTED=value'}
    before = runtime.read_text()
    with pytest.raises(ValueError): runtime_config.install(runtime, invalid)
    assert runtime.read_text() == before


def test_provisioning_preserves_installed_recovery_without_local_secret():
    spec = importlib.util.spec_from_file_location('provision_filter', Path(__file__).parents[1]/'deploy/provision/filter_plugins/provision.py')
    filters = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(filters)
    existing = 'OTHER=private\nBHIDNE_HO_RECOVERY_ENABLED=1\nBHIDNE_HO_RECOVERY_KEYS=preserve-key\n'
    rendered = filters.recovery_env_text(existing)
    assert 'OTHER' not in rendered
    assert 'BHIDNE_HO_RECOVERY_KEYS=preserve-key' in rendered
    assert filters.recovery_env_text(existing, {'BHIDNE_HO_RECOVERY_ENABLED':'0'}).startswith('BHIDNE_HO_RECOVERY_ENABLED=0')
    with pytest.raises(ValueError): filters.recovery_env_text(existing, {'UNRELATED':'override'})
    with pytest.raises(ValueError): filters.recovery_env_text(existing, {'BHIDNE_HO_RECOVERY_KEYS':'bad\nINJECTED=1'})


def test_provisioning_preserves_and_revokes_moderator_settings():
    spec = importlib.util.spec_from_file_location('moderation_filter', Path(__file__).parents[1]/'deploy/provision/filter_plugins/provision.py')
    filters = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(filters)
    existing='OTHER=private\nBHIDNE_HO_MODERATOR_USER_IDS=user-id\nBHIDNE_HO_MODERATOR_EMAILS=admin@example.test\n'
    rendered=filters.moderation_env_text(existing)
    assert 'OTHER' not in rendered
    assert 'BHIDNE_HO_MODERATOR_USER_IDS=user-id' in rendered
    assert 'BHIDNE_HO_MODERATOR_EMAILS=admin@example.test' in rendered
    assert filters.moderation_env_text(existing, {'BHIDNE_HO_MODERATOR_USER_IDS':''}).endswith('BHIDNE_HO_MODERATOR_USER_IDS=')
    with pytest.raises(ValueError): filters.moderation_env_text(existing, {'UNRELATED':'override'})
    with pytest.raises(ValueError): filters.moderation_env_text(existing, {'BHIDNE_HO_MODERATOR_EMAILS':'bad\nINJECTED=1'})
