"""Version 1 authorized-view patches. Never pass canonical engine state here.

Objects are patched recursively; arrays are replaced whole. The checksum encoding
is independent of Python/JavaScript number printing and object insertion order.
No runtime delivery path is enabled by this module.
"""
from copy import deepcopy
from hashlib import sha256
import json
import math
import struct


MAX_OPERATIONS = 4096
MAX_BYTES = 262144
MAX_DEPTH = 64
FORBIDDEN = frozenset(('__proto__', 'prototype', 'constructor'))


class DeltaError(ValueError):
    """Reconcile with an authorized snapshot rather than apply this update."""


def _text(value):
    return value.encode('utf-16-be', errors='surrogatepass').hex()


def _normalized(value, depth=0):
    if depth > MAX_DEPTH:
        raise DeltaError('View exceeds nesting limit.')
    if value is None:
        return ['null']
    if type(value) is bool:
        return ['bool', value]
    if type(value) in (int, float):
        if (type(value) is int and abs(value) > 2**53 - 1):
            raise DeltaError('View contains an unsupported number.')
        if (not math.isfinite(value)
                or (float(value).is_integer() and abs(value) > 2**53 - 1)):
            raise DeltaError('View contains an unsupported number.')
        return ['number', struct.pack('>d', float(value) if value else 0.0).hex()]
    if type(value) is str:
        return ['string', _text(value)]
    if type(value) is list:
        return ['array', [_normalized(v, depth + 1) for v in value]]
    if type(value) is dict:
        if any(type(k) is not str or k in FORBIDDEN for k in value):
            raise DeltaError('View contains an unsupported object key.')
        return ['object', [[_text(k), _normalized(value[k], depth + 1)]
                           for k in sorted(value, key=_text)]]
    raise DeltaError('View is not JSON data.')


def canonical_view(value):
    result = json.dumps(_normalized(value), separators=(',', ':'), allow_nan=False)
    if len(result) > MAX_BYTES * 8:
        raise DeltaError('View exceeds checksum size limit.')
    return result


def view_checksum(value):
    return sha256(canonical_view(value).encode('ascii')).hexdigest()


def _revision(value):
    if type(value) is not int or not 0 <= value <= 2**53 - 1:
        raise DeltaError('Invalid delta revision.')


def make_delta(before, after, *, game_id, base_revision, revision):
    _revision(base_revision)
    _revision(revision)
    if not isinstance(game_id, str) or not game_id or revision <= base_revision:
        raise DeltaError('Invalid delta identity or boundary.')
    base_checksum, checksum = view_checksum(before), view_checksum(after)
    operations = []

    def diff(old, new, path):
        if type(old) is dict and type(new) is dict:
            for key in sorted(old.keys() - new.keys(), key=_text):
                operations.append({'op': 'remove', 'path': path + [key]})
            for key in sorted(new, key=_text):
                if key not in old:
                    operations.append({'op': 'set', 'path': path + [key], 'value': deepcopy(new[key])})
                else:
                    diff(old[key], new[key], path + [key])
        elif _normalized(old) != _normalized(new):
            operations.append({'op': 'set', 'path': path, 'value': deepcopy(new)})
        if len(operations) > MAX_OPERATIONS:
            raise DeltaError('Delta exceeds operation limit.')

    diff(before, after, [])
    result = dict(version=1, game_id=game_id, base_revision=base_revision,
                  revision=revision, base_checksum=base_checksum, checksum=checksum,
                  operations=operations)
    if len(json.dumps(result, ensure_ascii=True, separators=(',', ':'))) > MAX_BYTES:
        raise DeltaError('Delta exceeds byte limit.')
    # Verify the actual wire codec, not just the comparison algorithm.
    if view_checksum(apply_delta(before, result, game_id=game_id, revision=base_revision)) != checksum:
        raise DeltaError('Generated delta failed verification.')
    return result


def apply_delta(before, delta, *, game_id, revision):
    _revision(revision)
    fields = {'version', 'game_id', 'base_revision', 'revision', 'base_checksum', 'checksum', 'operations'}
    if type(delta) is not dict or set(delta) != fields or type(delta['version']) is not int or delta['version'] != 1:
        raise DeltaError('Unsupported delta format.')
    _revision(delta['base_revision'])
    _revision(delta['revision'])
    if delta['game_id'] != game_id or delta['base_revision'] != revision or delta['revision'] <= revision:
        raise DeltaError('Delta does not match the current view.')
    for key in ('base_checksum', 'checksum'):
        if (type(delta[key]) is not str or len(delta[key]) != 64
                or any(c not in '0123456789abcdef' for c in delta[key])):
            raise DeltaError('Invalid delta checksum.')
    if view_checksum(before) != delta['base_checksum']:
        raise DeltaError('Delta base checksum differs.')
    operations = delta['operations']
    if type(operations) is not list or len(operations) > MAX_OPERATIONS:
        raise DeltaError('Invalid delta operations.')
    if len(json.dumps(delta, ensure_ascii=True, separators=(',', ':'))) > MAX_BYTES:
        raise DeltaError('Delta exceeds byte limit.')
    value = deepcopy(before)
    paths = []
    for operation in operations:
        if type(operation) is not dict or operation.get('op') not in ('set', 'remove'):
            raise DeltaError('Invalid patch operation.')
        fields = {'op', 'path', 'value'} if operation['op'] == 'set' else {'op', 'path'}
        path = operation.get('path')
        if (set(operation) != fields or type(path) is not list or len(path) > MAX_DEPTH
                or any(type(k) is not str or k in FORBIDDEN for k in path)):
            raise DeltaError('Invalid patch path.')
        if any(path[:len(p)] == p or p[:len(path)] == path for p in paths):
            raise DeltaError('Overlapping patch paths.')
        paths.append(path)
        if operation['op'] == 'set':
            canonical_view(operation['value'])
        if not path:
            if operation['op'] != 'set':
                raise DeltaError('Cannot remove the root.')
            value = deepcopy(operation['value'])
            continue
        parent = value
        for key in path[:-1]:
            if type(parent) is not dict or key not in parent:
                raise DeltaError('Patch parent is unavailable.')
            parent = parent[key]
        if type(parent) is not dict:
            raise DeltaError('Patch parent is not an object.')
        if operation['op'] == 'remove':
            if path[-1] not in parent:
                raise DeltaError('Removed field is unavailable.')
            del parent[path[-1]]
        else:
            parent[path[-1]] = deepcopy(operation['value'])
    if view_checksum(value) != delta['checksum']:
        raise DeltaError('Delta result checksum differs.')
    return value
