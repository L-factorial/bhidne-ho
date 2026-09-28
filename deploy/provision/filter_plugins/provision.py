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


class FilterModule:
    def filters(self):
        return {"private_ipv4": private_ipv4}
