// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// A tiny in-memory LRU cache. Exists because OneMap's real quota bites fast —
// one journey is ~10 reverse-geocode calls plus up to 8 routing calls (see
// CONTRACTS.md § 2.2), and a demo rehearsal repeats the same handful of
// coordinates dozens of times. `Map` preserves insertion order in JS, which is
// exactly what an LRU needs — no library required for something this small.
//
// Per-process, in-memory only. Resets on server restart; that's fine, this
// exists to survive one rehearsal/demo session, not across them.

export class LruCache<K, V> {
  private readonly maxEntries: number;
  private readonly store = new Map<K, V>();

  constructor(maxEntries: number) {
    if (maxEntries <= 0) throw new Error('LruCache: maxEntries must be > 0');
    this.maxEntries = maxEntries;
  }

  get(key: K): V | undefined {
    if (!this.store.has(key)) return undefined;
    const value = this.store.get(key) as V;
    // Touch: delete + re-insert moves this key to the "most recently used" end.
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.store.delete(key);
    this.store.set(key, value);
    if (this.store.size > this.maxEntries) {
      // Map iteration order is insertion order — the first key is the LRU one.
      const oldestKey = this.store.keys().next().value as K;
      this.store.delete(oldestKey);
    }
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Wraps an async function with LRU caching, keyed by `keyFn(...args)`.
 *
 * Caches the in-flight PROMISE, not just the resolved value — two callers
 * racing for the same key (e.g. comfort.ts's parallel waypoint legs) share
 * one upstream call instead of firing two. Same "single in-flight" principle
 * as onemap.ts's own token refresh.
 *
 * Only a successful result stays cached: a rejected call (429, network error)
 * removes itself from the cache so the next call retries for real instead of
 * replaying the same failure forever.
 */
export function memoizeAsync<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  keyFn: (...args: Args) => string,
  maxEntries: number,
): (...args: Args) => Promise<R> {
  const cache = new LruCache<string, Promise<R>>(maxEntries);

  return (...args: Args): Promise<R> => {
    const key = keyFn(...args);
    const cached = cache.get(key);
    if (cached) return cached;

    const promise = fn(...args).catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, promise);
    return promise;
  };
}
