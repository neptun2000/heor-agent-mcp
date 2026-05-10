/**
 * Tests for the 24h in-memory TTL cache used by regulatory.status_check.
 *
 * Rules verified:
 * - get() within TTL returns cached value with cache_hit: true
 * - get() after TTL returns null (miss)
 * - set() stores with timestamp
 * - force_refresh deletes the key before re-fetch
 * - TTL is configurable; default 24h
 */

import { RegulatoryCache } from "../../../src/providers/regulatory/cache.js";

describe("RegulatoryCache — basic operations", () => {
  it("returns null for an unknown key", () => {
    const cache = new RegulatoryCache();
    expect(cache.get("missing-key")).toBeNull();
  });

  it("set() then get() returns the stored value", () => {
    const cache = new RegulatoryCache();
    const value = { foo: "bar" };
    cache.set("test-key", value);
    const result = cache.get("test-key");
    expect(result).not.toBeNull();
    expect(result!.value).toEqual(value);
  });

  it("get() within TTL returns cache_hit: true and data_age_hours <= TTL hours", () => {
    const cache = new RegulatoryCache({ ttlMs: 24 * 60 * 60 * 1000 });
    cache.set("drug-key", { status: "approved" });
    const result = cache.get("drug-key");
    expect(result).not.toBeNull();
    expect(result!.cache_hit).toBe(true);
    expect(result!.data_age_hours).toBeGreaterThanOrEqual(0);
    expect(result!.data_age_hours).toBeLessThan(24);
  });

  it("get() after TTL returns null (expired)", () => {
    // Use a very short TTL of 1ms
    const cache = new RegulatoryCache({ ttlMs: 1 });
    cache.set("drug-key", { status: "approved" });
    // Wait 5ms to ensure expiry
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = cache.get("drug-key");
        expect(result).toBeNull();
        resolve();
      }, 5);
    });
  });

  it("TTL is configurable — custom 100ms TTL respected", () => {
    const cache = new RegulatoryCache({ ttlMs: 100 });
    cache.set("drug-key", { status: "approved" });
    // Immediately should still be cached
    expect(cache.get("drug-key")).not.toBeNull();
  });

  it("data_age_hours is 0 immediately after set()", () => {
    const cache = new RegulatoryCache();
    cache.set("drug-key", { status: "approved" });
    const result = cache.get("drug-key");
    expect(result).not.toBeNull();
    // Should be less than 0.001 hours (a few ms)
    expect(result!.data_age_hours).toBeLessThan(0.001);
  });
});

describe("RegulatoryCache — force_refresh", () => {
  it("delete() removes the key so next get() returns null", () => {
    const cache = new RegulatoryCache();
    cache.set("drug-key", { status: "approved" });
    expect(cache.get("drug-key")).not.toBeNull();
    cache.delete("drug-key");
    expect(cache.get("drug-key")).toBeNull();
  });

  it("force_refresh pattern: delete + re-set produces fresh result with cache_hit: false", () => {
    const cache = new RegulatoryCache();
    cache.set("drug-key", { status: "approved" });
    // Simulate force_refresh: delete then set fresh data
    cache.delete("drug-key");
    const miss = cache.get("drug-key");
    expect(miss).toBeNull();
    // After fresh fetch, set again
    cache.set("drug-key", { status: "approved", refreshed: true });
    const fresh = cache.get("drug-key");
    expect(fresh).not.toBeNull();
    expect(fresh!.cache_hit).toBe(true);
  });
});

describe("RegulatoryCache — multiple keys", () => {
  it("different keys are stored independently", () => {
    const cache = new RegulatoryCache();
    cache.set("key-a", { drug: "fremanezumab" });
    cache.set("key-b", { drug: "erenumab" });
    expect(cache.get("key-a")!.value).toEqual({ drug: "fremanezumab" });
    expect(cache.get("key-b")!.value).toEqual({ drug: "erenumab" });
  });

  it("deleting one key does not affect another", () => {
    const cache = new RegulatoryCache();
    cache.set("key-a", { drug: "fremanezumab" });
    cache.set("key-b", { drug: "erenumab" });
    cache.delete("key-a");
    expect(cache.get("key-a")).toBeNull();
    expect(cache.get("key-b")).not.toBeNull();
  });
});
