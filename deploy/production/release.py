#!/usr/bin/python3
"""Root-owned forced SSH command. Only deploys digests from one configured repository."""
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import shutil
import tarfile
import uuid
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

CONTAINER = 'bhidne-prod-app'
PREVIOUS = 'bhidne-prod-previous'
CONFIG = Path('/etc/bhidne-prod/release.json')
ENVIRONMENT = '/etc/bhidne-prod/runtime.env'
FRONTEND = Path('/srv/bhidne-prod/frontend')
CHECK = '''import asyncio
from app.durable_games.bootstrap import Settings, verify_dataset
from psycopg_pool import AsyncConnectionPool
from redis.asyncio import Redis
async def check():
 s = Settings.environment()
 async with AsyncConnectionPool(s.database, open=False) as p:
  await p.wait(timeout=15)
  await verify_dataset(p)
 r = Redis.from_url(s.redis, socket_connect_timeout=5, socket_timeout=5)
 try:
  assert await r.ping()
 finally:
  await r.aclose()
asyncio.run(check())
'''


def parse_request(command):
    match = re.fullmatch(r'(check|deploy|migrate|backend|frontend) (sha256:[0-9a-f]{64})', command)
    if not match:
        raise ValueError('Only approved release phases with a sha256 digest are allowed.')
    return match.groups()


def registry_credentials(payload):
    if len(payload) > 16384:
        raise ValueError('Oversized registry credentials.')
    value = json.loads(payload)
    if (not isinstance(value, dict) or set(value) != {'username', 'token'}
            or not isinstance(value['username'], str)
            or not re.fullmatch(r'[a-zA-Z0-9_.\[\]-]{1,100}', value['username'])
            or not isinstance(value['token'], str)
            or not 20 <= len(value['token']) <= 4096
            or any(character.isspace() for character in value['token'])):
        raise ValueError('Invalid registry credentials.')
    return value


def validate_config(config):
    if not re.fullmatch(r'ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+', config['repository']):
        raise ValueError('Invalid image repository.')
    for key in ('private_ip', 'peer_ip'):
        address = ipaddress.IPv4Address(config[key])
        if not any(address in ipaddress.IPv4Network(n) for n in
                   ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
            raise ValueError('Application addresses must be private IPv4.')
    if config['private_ip'] == config['peer_ip']:
        raise ValueError('Application addresses must differ.')


def command(*args, capture=False):
    # Do not print docker inspect or subprocess errors: they can contain environment secrets.
    result = subprocess.run(args, capture_output=True, text=True, timeout=600)
    if result.returncode:
        raise RuntimeError('Release operation failed; inspect the host locally.')
    return result.stdout if capture else None


def inspect_container(name):
    names = command('docker', 'container', 'ls', '-a', '--format', '{{.Names}}', capture=True)
    if name not in names.splitlines():
        return None
    return json.loads(command('docker', 'inspect', name, capture=True))[0]


def health(address):
    try:
        with urlopen(f'http://{address}:8080/health', timeout=3) as response:
            return response.status == 200 and json.load(response).get('status') == 'ok'
    except Exception:
        return False


def wait_ready(address):
    for _ in range(45):
        if health(address):
            return
        time.sleep(2)
    raise RuntimeError('Application readiness timed out.')


def sandbox():
    credentials = Path('/etc/bhidne-prod/apns')
    mounts = ['--mount', f'type=bind,src={credentials},dst=/run/bhidne-apns,readonly'] if credentials.is_dir() else []
    return mounts + ['--user', '10001:10001', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--pids-limit', '256',
            '--memory', '2g', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
            '--env-file', ENVIRONMENT, '--log-driver', 'json-file',
            '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3']


def environment_revision():
    return hashlib.sha256(Path(ENVIRONMENT).read_bytes()).hexdigest()


def unpack_frontend(archive, destination):
    """Bounded extraction of regular build files; never trust archive paths/links."""
    size = 0
    seen = set()
    with tarfile.open(archive, 'r:gz') as bundle:
        for index, member in enumerate(bundle):
            if index >= 20000:
                raise ValueError('Too many frontend files.')
            path = Path(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isdir() or member.isfile()):
                raise ValueError('Invalid frontend archive member.')
            if path == Path('.'):
                if member.isdir():
                    continue
                raise ValueError('Invalid root entry.')
            if str(path) in seen:
                raise ValueError('Duplicate frontend archive member.')
            seen.add(str(path))
            target = destination / path
            size += member.size
            if size > 128 * 1024 * 1024:
                raise ValueError('Frontend export exceeds size limit.')
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            if member.isdir():
                target.mkdir(exist_ok=True, mode=0o755)
            else:
                with bundle.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o644)
    if not (destination / 'index.html').is_file() or not (destination / 'index.html').stat().st_size:
        raise ValueError('Missing frontend index.')


def stage_frontend(image, digest):
    """Pre-stage hashed assets on BOTH hosts before either release is activated."""
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise ValueError('Invalid frontend image digest.')
    FRONTEND.mkdir(parents=True, exist_ok=True, mode=0o755)
    releases = FRONTEND / 'releases'
    releases.mkdir(exist_ok=True, mode=0o755)
    target = releases / digest.split(':')[1]
    if not target.exists():
        with tempfile.TemporaryDirectory(dir=releases, prefix='staging-') as directory:
            staging = Path(directory)
            name = 'bhidne-prod-assets-' + uuid.uuid4().hex
            command('docker', 'create', '--name', name, image)
            try:
                command('docker', 'cp', name + ':/opt/bhidne-frontend.tar.gz', str(staging / 'export.tar.gz'))
            finally:
                command('docker', 'rm', name)
            if (staging / 'export.tar.gz').stat().st_size > 32 * 1024 * 1024:
                raise ValueError('Compressed frontend export exceeds size limit.')
            content = staging / 'content'
            content.mkdir(mode=0o755)
            unpack_frontend(staging / 'export.tar.gz', content)
            content.rename(target)
    # Expo places content-addressed scripts/fonts/images in these two directories.
    # Keep older assets for open tabs and rollback; never overwrite a conflicting name.
    for subtree in ('assets', '_expo'):
        source_root = target / subtree
        if not source_root.exists():
            continue
        for source in source_root.rglob('*'):
            if not source.is_file():
                continue
            destination = FRONTEND / 'shared' / source.relative_to(target)
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            if destination.exists():
                if source.read_bytes() != destination.read_bytes():
                    raise ValueError('Frontend asset name collision.')
                continue
            temporary = destination.with_name(destination.name + '.staging')
            shutil.copyfile(source, temporary)
            temporary.chmod(0o644)
            os.replace(temporary, destination)
    return target


def switch_frontend(target):
    current = FRONTEND / 'current'
    if target is None:
        current.unlink(missing_ok=True)
        return
    temporary = FRONTEND / 'next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, current)


def verify_frontend(target):
    request = Request('http://127.0.0.1/', headers={'Host': 'prod.bhidne-ho.lfactorial.com'})
    with urlopen(request, timeout=5) as response:
        if response.status != 200 or response.read(2 * 1024 * 1024) != (target / 'index.html').read_bytes():
            raise RuntimeError('Nginx frontend verification failed.')


def release(config, operation, digest):
    validate_config(config)
    image = config['repository'] + '@' + digest
    command('docker', 'pull', image)
    if operation == 'migrate':
        command('docker', 'run', '--rm', *sandbox(), image, 'python', '-m', 'app.durable_games.bootstrap', 'migrate')
        return
    # A schema mismatch or dependency outage must fail before stopping the old app.
    command('docker', 'run', '--rm', *sandbox(), image, 'python', '-c', CHECK)
    frontend = stage_frontend(image, digest) if config.get('frontend') else None
    old_frontend = (FRONTEND / 'current').resolve() if (FRONTEND / 'current').is_symlink() else None
    if operation == 'check':
        print('Image and dependency/schema checks passed.')
        return
    if operation == 'frontend':
        running = inspect_container(CONTAINER)
        if not running or running['Config']['Image'] != image or not health(config['private_ip']):
            raise RuntimeError('Activate frontend only after this backend is healthy at the requested image.')
        if frontend:
            try:
                switch_frontend(frontend); verify_frontend(frontend)
            except BaseException:
                switch_frontend(old_frontend); raise
        return
    if operation == 'backend':
        frontend = None  # Both backends must be upgraded before either frontend.
    revision = environment_revision()
    old = inspect_container(CONTAINER)
    if old and (old['Config'].get('Labels') or {}).get('com.bhidne.managed') != 'production':
        raise RuntimeError('Refusing to replace an unmanaged container.')
    if (old and old['Config']['Image'] == image
            and (old['Config'].get('Labels') or {}).get('com.bhidne.environment') == revision
            and health(config['private_ip'])):
        if frontend:
            try:
                switch_frontend(frontend)
                verify_frontend(frontend)
            except BaseException:
                switch_frontend(old_frontend)
                raise
        print('Requested image is already healthy.')
        return
    if old and not health(config['peer_ip']):
        raise RuntimeError('Peer is not ready; refusing to stop this application.')
    previous = inspect_container(PREVIOUS)
    if previous:
        if (previous['Config'].get('Labels') or {}).get('com.bhidne.managed') != 'production':
            raise RuntimeError('Unmanaged rollback container found.')
        command('docker', 'rm', PREVIOUS)
    renamed = False
    try:
        if old:
            command('docker', 'stop', '--time', '60', CONTAINER)
            command('docker', 'rename', CONTAINER, PREVIOUS)
            renamed = True
        command('docker', 'run', '-d', '--name', CONTAINER,
                '--label', 'com.bhidne.managed=production',
                '--label', 'com.bhidne.environment=' + revision, '--restart', 'unless-stopped',
                '--stop-timeout', '60', *sandbox(),
                '-p', f"{config['private_ip']}:8080:8080", '-p', '127.0.0.1:9108:9108',
                image, 'uvicorn', 'app.durable_games.bootstrap:create_app', '--factory',
                '--host', '0.0.0.0', '--port', '8080', '--workers', '1',
                '--no-access-log', '--timeout-graceful-shutdown', '30')
        wait_ready(config['private_ip'])
        if frontend:
            switch_frontend(frontend)
            verify_frontend(frontend)
    except BaseException:
        if frontend:
            switch_frontend(old_frontend)
        if renamed or old is None:
            if inspect_container(CONTAINER):
                command('docker', 'rm', '-f', CONTAINER)
        if renamed:
            command('docker', 'rename', PREVIOUS, CONTAINER)
        if old:
            command('docker', 'start', CONTAINER)
            wait_ready(config['private_ip'])
        raise
    print('Deployment healthy: ' + digest)


def main():
    operation, digest = parse_request(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    os.environ['PATH'] = '/usr/sbin:/usr/bin:/sbin:/bin'
    for name in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
        os.environ.pop(name, None)
    if os.geteuid() != 0:
        raise RuntimeError('Release receiver must run as root.')
    # A dropped SSH connection must not kill the receiver midway through replacement.
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    with open(CONFIG.parent / 'release.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        credentials = registry_credentials(sys.stdin.read(16385))
        with tempfile.TemporaryDirectory(prefix='registry-', dir=CONFIG.parent) as directory:
            os.environ['DOCKER_CONFIG'] = directory
            result = subprocess.run(
                ['docker', 'login', 'ghcr.io', '--username', credentials['username'], '--password-stdin'],
                input=credentials['token'], capture_output=True, text=True, timeout=30,
            )
            if result.returncode:
                raise RuntimeError('Registry authentication failed.')
            release(json.loads(CONFIG.read_text()), operation, digest)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Release failed. Consult the server administrator; no secrets are logged.', file=sys.stderr)
        sys.exit(1)
