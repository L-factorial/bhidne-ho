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
        return {"private_ipv4": private_ipv4, "recovery_env_text": recovery_env_text}
