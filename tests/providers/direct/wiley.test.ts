import { fetchWiley } from "../../../src/providers/direct/wiley.js";
import { liveIt } from "../../helpers/live.js";

describe("fetchWiley", () => {
  // Deterministic (mocked) — always runs.
  it("throws on Crossref API errors so the dispatcher can record failure", async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limit",
    });
    await expect(fetchWiley("cost-effectiveness diabetes", 5)).rejects.toThrow(
      /\[Wiley\] API 429/,
    );
    global.fetch = origFetch;
  });

  // Live Crossref calls — gated behind RUN_LIVE_TESTS (see tests/helpers/live.ts).
  liveIt("each result has required fields when results returned", async () => {
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

  liveIt("respects maxResults limit", async () => {
    const results = await fetchWiley("health economics", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  }, 15000);

  liveIt("returns an array from live Crossref when API is healthy", async () => {
    const results = await fetchWiley("cost-effectiveness diabetes", 5);
    expect(Array.isArray(results)).toBe(true);
  }, 15000);
});
