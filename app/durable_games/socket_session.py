"""Bounded socket authentication freshness, independent of Redis and client pings."""
import asyncio
import math
import time

from app.auth.service import AuthenticationError


class SocketSession:
    def __init__(self, authenticate, token, owner, *, interval=5.0, timeout=2.0):
        if any(not math.isfinite(v) or v <= 0 for v in (interval, timeout)):
            raise ValueError('Invalid socket session check bounds.')
        self.authenticate, self._token, self.owner = authenticate, token, owner
        self.interval, self.timeout = interval, timeout
        self.identity = None
        self.deadline = 0.0
        self.close_code = None
        self._lock = asyncio.Lock()
        self._task = None
        self._stopped = False

    async def check(self):
        async with self._lock:
            if self._stopped or self.close_code is not None:
                raise RuntimeError('Socket session unavailable.')
            if time.monotonic() < self.deadline:
                return self.identity
            started = time.monotonic()
            try:
                async with asyncio.timeout(self.timeout):
                    identity = await self.authenticate(self._token)
                if self._stopped or time.monotonic() >= started + self.interval:
                    raise TimeoutError('Session check is no longer fresh.')
                if self.identity is not None and identity != self.identity:
                    raise AuthenticationError('Session identity changed.')
                self.identity = identity
                # Measure from check start, not completion; slow checks cannot
                # extend the authorization window. Late sends recheck again.
                self.deadline = started + self.interval
                return identity
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.close_code = 1008 if isinstance(error, AuthenticationError) else 1011
                if asyncio.current_task() is not self.owner:
                    self.owner.cancel()
                if self.close_code == 1008:
                    raise AuthenticationError('Socket session invalid.') from None
                raise RuntimeError('Socket session verification unavailable.') from None

    def start(self):
        if self._task is not None or self._stopped:
            raise RuntimeError('Socket session requires a fresh lifecycle.')
        self._task = asyncio.create_task(self._watch(), name='socket-session-check')

    async def _watch(self):
        try:
            while True:
                await asyncio.sleep(max(.001, self.deadline - time.monotonic()))
                await self.check()
        except (AuthenticationError, RuntimeError):
            pass  # check has closed admission and cancelled the owning socket.

    async def stop(self):
        self._stopped = True
        self._token = None
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
