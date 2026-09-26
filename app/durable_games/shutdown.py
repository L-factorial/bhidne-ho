"""Bounded shutdown SQL attempts; caller must stop execution before releasing."""
import asyncio
from dataclasses import dataclass

from .ownership import QuarantinedRoom, StaleInstance
from .recovery_coordinator import _TRANSIENT
from .store import StaleGameOwner


@dataclass(frozen=True)
class ReleaseResult:
    room_id: str
    epoch: int
    status: str
    error_type: str | None = None


@dataclass(frozen=True)
class DrainReport:
    routing_status: str
    releases: tuple[ReleaseResult, ...]


async def shutdown_attempt(method, *args, timeout, retry_base, retry_max, **kwargs):
    """Three same-input attempts; uncertainty is never a successful release."""
    for attempt in range(3):
        try:
            async with asyncio.timeout(timeout):
                await method(*args, **kwargs)
            return 'confirmed', None
        except _TRANSIENT as error:
            if attempt == 2:
                return 'uncertain', type(error).__name__
            await asyncio.sleep(min(retry_max, retry_base * 2 ** attempt))
        except QuarantinedRoom as error:
            return 'quarantined', type(error).__name__
        except (StaleGameOwner, StaleInstance) as error:
            return 'ownership_lost', type(error).__name__
        except Exception as error:
            return 'failed', type(error).__name__
