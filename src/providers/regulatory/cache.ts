/**
 * 24h in-memory TTL cache for regulatory.status_check results.
 *
 * Design contract:
 * - get() returns null on miss (expired or never set)
 * - get() returns { value, cache_hit: true, data_age_hours } on hit
 * - set() stores value with current timestamp
 * - delete() removes key (used for force_refresh)
 * - TTL configurable; default 24h
 */

interface CacheEntry<T> {
  value: T;
  storedAt: number; // Date.now()
}

interface CacheHit<T> {
  value: T;
  cache_hit: true;
  data_age_hours: number;
}

export class RegulatoryCache<T = unknown> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;

  constructor(options?: { ttlMs?: number }) {
    // Default 24h TTL
    this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * Returns null on cache miss (expired or never set).
   * Returns { value, cache_hit: true, data_age_hours } on hit.
   */
  get(key: string): CacheHit<T> | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const ageMs = Date.now() - entry.storedAt;
    if (ageMs > this.ttlMs) {
      // Expired — remove and return null
      this.store.delete(key);
      return null;
    }

    return {
      value: entry.value,
      cache_hit: true,
      data_age_hours: ageMs / (1000 * 60 * 60),
    };
  }

  /**
   * Stores value with current timestamp.
   */
  set(key: string, value: T): void {
    this.store.set(key, { value, storedAt: Date.now() });
  }

  /**
   * Removes key from cache (used by force_refresh logic).
   */
  delete(key: string): void {
    this.store.delete(key);
  }
}
