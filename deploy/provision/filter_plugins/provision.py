"""Strict network validation before a provisioning task can mutate a host."""
from ipaddress import IPv4Address, IPv4Network

_PRIVATE = tuple(IPv4Network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


def private_ipv4(value):
    if not isinstance(value, str):
        return False
    try:
        address = IPv4Address(value)
    except (ValueError, TypeError):
        return False
    return any(address in network for network in _PRIVATE)


def recovery_env_text(existing, updates=None):
    prefix = 'BHIDNE_HO_RECOVERY_'
    allowed = {prefix + name for name in ('ENABLED', 'PUBLIC_ORIGIN', 'FROM', 'KEYS',
        'SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS', 'SMTP_USERNAME', 'SMTP_PASSWORD')}
    values = {}
    for line in existing.splitlines():
        if line.startswith(prefix):
            key, separator, value = line.partition('=')
            if not separator or key not in allowed:
                raise ValueError('Unexpected recovery runtime setting.')
            values[key] = value
    if updates is not None:
        if not isinstance(updates, dict) or set(updates) - allowed:
            raise ValueError('Invalid recovery settings.')
        values.update(updates)
    if any(not isinstance(v, str) or v != v.strip() or any(c in v for c in '\r\n\0') for v in values.values()):
        raise ValueError('Recovery runtime values must be single-line strings.')
    return '\n'.join(key + '=' + value for key, value in sorted(values.items()))


class FilterModule:
    def filters(self):
        return {"private_ipv4": private_ipv4, "recovery_env_text": recovery_env_text, "moderation_env_text": moderation_env_text, "policy_env_text": policy_env_text, "push_env_text": push_env_text}


def moderation_env_text(existing, updates=None):
    allowed = {'BHIDNE_HO_MODERATOR_USER_IDS', 'BHIDNE_HO_MODERATOR_EMAILS'}
    values = {}
    for line in existing.splitlines():
        if line.startswith('BHIDNE_HO_MODERATOR_'):
            key, separator, value = line.partition('=')
            if not separator or key not in allowed:
                raise ValueError('Unexpected moderation runtime setting.')
            values[key] = value
    if updates is not None:
        if not isinstance(updates, dict) or set(updates) - allowed:
            raise ValueError('Invalid moderation settings.')
        values.update(updates)
    if any(not isinstance(v, str) or v != v.strip() or any(c in v for c in '\r\n\0') for v in values.values()):
        raise ValueError('Moderation runtime values must be single-line strings.')
    return '\n'.join(key + '=' + value for key, value in sorted(values.items()))


def policy_env_text(existing, updates=None):
    allowed = {'BHIDNE_HO_POLICY_OPERATOR','BHIDNE_HO_SUPPORT_EMAIL','BHIDNE_HO_MINIMUM_AGE','BHIDNE_HO_BACKUP_DISCLOSURE'}
    values = {}
    for line in existing.splitlines():
        key, separator, value = line.partition('=')
        if key in allowed and separator:
            values[key] = value
    if updates is not None:
        if not isinstance(updates, dict) or set(updates) - allowed:
            raise ValueError('Invalid public policy settings.')
        values.update(updates)
    if any(not isinstance(v, str) or v != v.strip() or any(c in v for c in '\r\n\0') for v in values.values()):
        raise ValueError('Public policy values must be single-line strings.')
    return '\n'.join(key + '=' + value for key, value in sorted(values.items()))


def push_env_text(existing, updates=None):
    allowed = {'BHIDNE_APNS_KEY_FILE','BHIDNE_APNS_TEAM_ID','BHIDNE_APNS_KEY_ID','BHIDNE_APNS_TOPIC'}
    values = dict(line.split('=',1) for line in existing.splitlines()
                  if '=' in line and line.split('=',1)[0] in allowed)
    if updates is not None:
        if not isinstance(updates,dict) or set(updates)-allowed:
            raise ValueError('Invalid APNs settings.')
        values.update(updates)
    if any(not isinstance(v,str) or v!=v.strip() or any(c in v for c in '\r\n\0') for v in values.values()):
        raise ValueError('APNs values must be single-line strings.')
    return '\n'.join(key+'='+value for key,value in sorted(values.items()))
