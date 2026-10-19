"""Read cache: one entry per endpoint + params, 60 s, cleared by any write or POST /refresh."""
import threading
import time
from typing import Any, Callable, Hashable

TTL_SECONDS = 60.0


class ReadCache:
    def __init__(self, ttl: float = TTL_SECONDS, clock: Callable[[], float] = time.monotonic):
        self._ttl, self._clock = ttl, clock
        self._items: dict = {}
        self._generation = 0
        self._lock = threading.Lock()

    def get(self, key: Hashable, compute: Callable[[], Any], refresh: bool = False) -> Any:
        """Cached value for `key`, else compute() (stored for the TTL). `refresh` skips the lookup
        but stores the fresh value. A value computed across a clear() is returned but not stored, so a
        read racing a write cannot put pre-write data back into the cache."""
        with self._lock:
            generation = self._generation
            hit = None if refresh else self._items.get(key)
            if hit is not None and hit[0] > self._clock():
                return hit[1]
        value = compute()
        with self._lock:
            if self._generation == generation:
                self._items[key] = (self._clock() + self._ttl, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._generation += 1
