"""Process-local telemetry. No payloads, network I/O, or database writes on emit.

Operation success means the method returned, NOT a committed command. Only the
inbox claim's post-transaction hook emits command outcomes. Metrics are diagnostic
and may be lost on crashes; durable receipts remain the accounting authority.
"""
import asyncio
from contextlib import contextmanager
from functools import wraps
import logging
import inspect
from time import perf_counter, monotonic
from uuid import UUID

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram
import structlog

REGISTRY = CollectorRegistry()
OPERATIONS = Counter('bhidne_operations_total', 'Method attempts by bounded operation and result.',
                     ['operation', 'result'], registry=REGISTRY)
DURATION = Histogram('bhidne_operation_seconds', 'Method wall time including waits.',
                     ['operation'], buckets=(.005, .02, .05, .1, .25, .5, 1, 2, 5, 10, 30), registry=REGISTRY)
COMMANDS = Counter('bhidne_command_outcomes_total', 'Commands observed after successful commit.',
                   ['lane_kind', 'result'], registry=REGISTRY)
GAME_COMMANDS = Counter('bhidne_game_command_outcomes_total', 'Committed gameplay commands by game type.',
                        ['game_type', 'result'], registry=REGISTRY)
COMMAND_TIME = Histogram('bhidne_command_transaction_seconds', 'Claim through commit, excluding time queued.',
                         ['lane_kind'], registry=REGISTRY)
SUBMISSIONS = Counter('bhidne_submissions_total', 'Committed ingress responses, including retries.',
                      ['lane_kind', 'result'], registry=REGISTRY)
EVENTS = Counter('bhidne_runtime_events_total', 'Fixed-name runtime transitions and failures.',
                 ['event'], registry=REGISTRY)
HTTP = Counter('bhidne_http_requests_total', 'HTTP responses by route template and status class.',
               ['route', 'method', 'status'], registry=REGISTRY)
HTTP_TIME = Histogram('bhidne_http_seconds', 'HTTP request wall time.', ['route'], registry=REGISTRY)
SOCKETS = Gauge('bhidne_websocket_connections', 'Currently accepted sockets.', registry=REGISTRY)
STATE = Gauge('bhidne_runtime_state', 'Process runtime gauges; state label is a fixed field name.',
              ['state'], registry=REGISTRY)
CACHE = Counter('bhidne_read_cache_total', 'Versioned projection cache lookups and writes.',
                ['result'], registry=REGISTRY)
ACTIVE_GAMES = Gauge('bhidne_active_games', 'Cluster active games; all is the total. Replicas must not be summed.',
                     ['game_type'], registry=REGISTRY)
ACTIVE_PLAYERS = Gauge('bhidne_active_players', 'Cluster distinct active game participants; all is the total.',
                       ['game_type'], registry=REGISTRY)
ONLINE_USERS = Gauge('bhidne_online_users', 'Cluster distinct users with unexpired socket presence.', registry=REGISTRY)
KINDS = frozenset(('room', 'table', 'game', 'room_chat', 'table_chat', 'game_chat', 'conversation', 'recipient'))
FIELDS = frozenset(('lane_id', 'room_id', 'table_id', 'game_id', 'command_id', 'sequence',
                    'job_id', 'epoch', 'error_type', 'result', 'operation', 'lane_kind', 'retrying', 'game_type'))
logger = logging.getLogger('bhidne.runtime')
logger.addHandler(logging.NullHandler())
_last_warning = {}


def configure_logging():
    """Configure only our logger; never stringify third-party request/SQL errors."""
    if getattr(logger, '_bhidne_configured', False):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=[structlog.stdlib.add_log_level,
                           structlog.processors.TimeStamper(fmt='iso', utc=True),
                           structlog.stdlib.ExtraAdder()],
        processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                    structlog.processors.JSONRenderer()]))
    logger.handlers[:] = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False
    logger._bhidne_configured = True


def safe_log(event, *, level=logging.INFO, **fields):
    # Explicit field allowlist prevents accidental payload/token/checkpoint dumps.
    # Event names are source-code constants. No exception messages or trace locals.
    try:
        values = {key: str(value)[:128] if isinstance(value, (str, UUID)) else value
                  for key, value in fields.items() if key in FIELDS
                  and isinstance(value, (str, UUID, bool, int, float))}
        if level >= logging.WARNING:
            # Bound outage log volume, while counters still record every failure.
            key = (event, values.get('operation'))
            now = monotonic()
            if now - _last_warning.get(key, -float('inf')) < 30:
                return
            if len(_last_warning) >= 256:
                _last_warning.clear()
            _last_warning[key] = now
        logger.log(level, event, extra=values)
    except Exception:
        pass  # Telemetry must never change command/transaction/cancellation behavior.


def event(name, *, log=True, **fields):
    try:
        EVENTS.labels(name).inc()
        if log:
            safe_log(name, level=logging.WARNING if name.endswith(("failed", "full")) else logging.INFO, **fields)
    except Exception:
        pass


def operation_done(name, result, elapsed, error=None, log_success=False, **context):
    try:
        OPERATIONS.labels(name, result).inc()
        DURATION.labels(name).observe(elapsed)
        if result == 'error':
            safe_log('operation_failed', level=logging.WARNING, operation=name,
                     error_type=type(error).__name__, result=result, **context)
        elif log_success:
            safe_log('operation_finished', operation=name, result=result, **context)
    except Exception:
        pass


def observe(name, *, log_success=False):
    """Static operation label, untouched return/exception/cancellation semantics."""
    def decorate(fn):
        identifiers = {key: index for index, key in enumerate(inspect.signature(fn).parameters)
                       if key in ('lane_id', 'room_id', 'table_id', 'job_id')}
        @wraps(fn)
        async def wrapped(*args, **kwargs):
            started = perf_counter()
            context = {key: kwargs[key] if key in kwargs else args[index]
                       for key, index in identifiers.items() if key in kwargs or index < len(args)}
            try:
                result = await fn(*args, **kwargs)
            except asyncio.CancelledError:
                operation_done(name, 'cancelled', perf_counter() - started)
                raise
            except Exception as error:
                operation_done(name, 'error', perf_counter() - started, error, **context)
                raise
            else:
                outcome = 'idle' if result is None else ('false' if result is False else 'returned')
                try:
                    status = result if isinstance(result, str) else getattr(result, 'status', None)
                except Exception:
                    status = None
                if isinstance(status, str) and status in ('prepared', 'busy', 'conflict', 'ownership_lost',
                        'retryable', 'unsupported', 'budget_exceeded', 'invalid', 'failed',
                        'serving', 'recovering', 'draining', 'projected', 'no_payment', 'already_completed'):
                    outcome = status
                operation_done(name, outcome, perf_counter() - started, log_success=log_success, **context)
                return result
        return wrapped
    return decorate


def submitted(target, entry, duplicate):
    try:
        kind = target.kind if target.kind in KINDS else 'other'
        result = 'duplicate' if duplicate or entry.duplicate else 'enqueued'
        SUBMISSIONS.labels(kind, result).inc()
        safe_log('command_submitted', lane_kind=kind, result=result, lane_id=entry.lane_id,
                 command_id=entry.request.command_id, room_id=target.room_id,
                 table_id=target.table_id, game_id=target.game_id, sequence=entry.sequence)
    except Exception:
        pass


@contextmanager
def command_attempt():
    """Enclose the entire transaction; fill holder after acquiring a lane head."""
    holder = []
    started = perf_counter()
    try:
        yield holder
    except BaseException as error:
        if holder:
            claim = holder[0]
            safe_log('command_attempt_incomplete', level=logging.WARNING,
                     lane_id=claim.entry.lane_id, command_id=claim.entry.request.command_id,
                     error_type=type(error).__name__)
        raise
    else:
        if holder:
            claim = holder[0]
            try:
                kind = claim.target.kind if claim.target.kind in KINDS else 'other'
                status = claim._telemetry_outcome
                COMMANDS.labels(kind, status).inc()
                game_type = getattr(claim, '_telemetry_game_type', None)
                if kind == 'game' and game_type in ('callbreak', 'marriage', 'flush'):
                    GAME_COMMANDS.labels(game_type, status).inc()
                COMMAND_TIME.labels(kind).observe(perf_counter() - started)
                safe_log('command_committed', lane_kind=kind, result=status, game_type=game_type,
                         lane_id=claim.entry.lane_id, command_id=claim.entry.request.command_id,
                         sequence=claim.entry.sequence, room_id=claim.target.room_id,
                         table_id=claim.target.table_id, game_id=claim.target.game_id)
            except Exception:
                pass


class TelemetryMiddleware:
    """Pure ASGI middleware: no bodies, tokens, raw paths, queries or socket frames."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] not in ('http', 'websocket'):
            return await self.app(scope, receive, send)
        started, status, accepted = perf_counter(), 500, False
        cancelled = False
        async def tracked(message):
            nonlocal status, accepted
            await send(message)
            if message['type'] == 'http.response.start':
                status = message['status']
            elif message['type'] == 'websocket.accept' and not accepted:
                accepted = True
                try:
                    SOCKETS.inc()
                except Exception:
                    pass
                event('socket_opened')
        try:
            await self.app(scope, receive, tracked)
        except asyncio.CancelledError:
            cancelled = True
            raise
        except Exception as error:
            event('transport_failed', error_type=type(error).__name__)
            raise
        finally:
            try:
                if scope['type'] == 'http':
                    route = getattr(scope.get('route'), 'path', 'unmatched')
                    method = scope.get('method', '')
                    method = method if method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD') else 'OTHER'
                    HTTP.labels(route, method, 'cancelled' if cancelled else str(status // 100) + 'xx').inc()
                    HTTP_TIME.labels(route).observe(perf_counter() - started)
                    if status >= 500 and not cancelled:
                        safe_log('http_failed', level=logging.WARNING, operation=route, result='5xx')
                elif accepted:
                    SOCKETS.dec()
                    event('socket_closed')
            except Exception:
                pass
