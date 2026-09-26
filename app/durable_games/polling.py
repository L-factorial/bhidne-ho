"""Adaptive inbox scanning; independent of ownership and timer maintenance."""
import math
import random


class RedisPollingPolicy:
    def __init__(self, *, healthy_interval=5.0, failed_interval=.35, jitter=.1):
        if (any(not math.isfinite(v) or v <= 0 for v in (healthy_interval, failed_interval))
                or failed_interval > healthy_interval or not math.isfinite(jitter) or not 0 <= jitter <= .5):
            raise ValueError('Invalid adaptive polling intervals.')
        self.healthy_interval, self.failed_interval, self.jitter = healthy_interval, failed_interval, jitter
        self.available = False
        self._changed = None

    def bind(self, changed):
        if self._changed is not None or not callable(changed):
            raise ValueError('Polling policy must bind to exactly one runtime.')
        self._changed = changed

    def observe(self, available):
        if type(available) is not bool:
            raise ValueError('Transport health must be boolean.')
        changed, self.available = self.available != available, available
        if changed and self._changed:
            self._changed()

    def delay(self):
        interval = self.healthy_interval if self.available else self.failed_interval
        return interval * random.uniform(1 - self.jitter, 1 + self.jitter)

    def sleep_limit(self):
        return self.healthy_interval if self.available else self.failed_interval * (1 - self.jitter)
