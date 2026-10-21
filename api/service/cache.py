"""Read cache (one per account): one entry per endpoint + params, 60 s, cleared by any write or POST
/refresh. Expired entries go whenever a value is stored, and it never holds more than `max_entries`
(the ones closest to expiry go first), so no client can grow it by asking for ever more keys."""
import threading
import time
from typing import Any, Callable, Hashable

TTL_SECONDS = 60.0
MAX_ENTRIES = 300


class ReadCache:
    def __init__(self, ttl: float = TTL_SECONDS, clock: Callable[[], float] = time.monotonic,
                 max_entries: int = MAX_ENTRIES):
        self._ttl, self._clock, self._max = ttl, clock, max_entries
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
                now = self._clock()
                self._items = {k: v for k, v in self._items.items() if v[0] > now and k != key}
                while len(self._items) >= self._max:
                    del self._items[min(self._items, key=lambda k: self._items[k][0])]
                self._items[key] = (now + self._ttl, value)
        return value

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._generation += 1
