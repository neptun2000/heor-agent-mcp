import { fetchWiley } from "../../../src/providers/direct/wiley.js";

describe("fetchWiley", () => {
  it("returns an array (never throws)", async () => {
    const results = await fetchWiley("cost-effectiveness diabetes", 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it("each result has required fields when results returned", async () => {
    const results = await fetchWiley("semaglutide pharmacoeconomics", 3);
    for (const r of results) {
      expect(r.id).toMatch(/^wiley_/);
      expect(r.source).toBe("wiley");
      expect(typeof r.title).toBe("string");
      expect(r.title.length).toBeGreaterThan(0);
      expect(Array.isArray(r.authors)).toBe(true);
      expect(typeof r.date).toBe("string");
      expect(typeof r.abstract).toBe("string");
      expect(typeof r.url).toBe("string");
      expect(r.url).toMatch(/^https?:\/\//);
    }
  }, 15000);

  it("respects maxResults limit", async () => {
    const results = await fetchWiley("health economics", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  }, 15000);

  it("returns empty array on network error (resilient)", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("Network error"); };
    const results = await fetchWiley("test", 5);
    expect(results).toEqual([]);
    global.fetch = originalFetch;
  });
});
