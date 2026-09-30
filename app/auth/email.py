"""Shared signup and recovery mailbox validation."""
import re


def normalize_recovery_email(value: str) -> str:
    """Conservative ASCII mailbox contract; preserve local part, lowercase domain.

    No provider-specific alias rewriting. Unicode mailbox support needs a future
    mail-provider decision, rather than silently changing someone's destination.
    """
    value = value.strip()
    if len(value) > 254 or not value.isascii() or value.count('@') != 1:
        raise ValueError('Enter a valid email address.')
    local, domain = value.split('@')
    labels = domain.split('.')
    if (not 1 <= len(local) <= 64 or local.startswith('.') or local.endswith('.')
            or '..' in local or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+", local)
            or len(labels) < 2 or any(not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label)
                                     for label in labels)):
        raise ValueError('Enter a valid email address.')
    return local + '@' + domain.lower()

