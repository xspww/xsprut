/**
 * A tiny generic in-memory TTL cache used by the DB caching layer.
 *
 * Entries expire lazily (on read) and are also swept periodically so expired
 * rows never accumulate. `set` with a ttlMs <= 0 is a no-op — use `delete`
 * for explicit removal instead.
 */
type CacheEntry<V> = { value: V; expiresAt: number };

export class TTLCache<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();
  private readonly defaultTtlMs: number;
  private readonly sweepTimer: NodeJS.Timeout | null = null;

  constructor(defaultTtlMs = 60_000, sweepIntervalMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
      // Don't keep the process alive just for the sweeper.
      this.sweepTimer.unref?.();
    }
  }

  /** Returns the cached value, or undefined on miss/expiry. */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Stores `value` under `key` for `ttlMs` (defaults to the cache TTL). */
  set(key: K, value: V, ttlMs: number = this.defaultTtlMs): void {
    if (ttlMs <= 0) return;
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Drop expired entries. Runs automatically on a timer. */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }
}
