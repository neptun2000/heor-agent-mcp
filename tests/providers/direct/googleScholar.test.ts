import { fetchGoogleScholar } from "../../../src/providers/direct/googleScholar.js";

describe("fetchGoogleScholar", () => {
  const originalKey = process.env.SERPAPI_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.SERPAPI_KEY;
    } else {
      process.env.SERPAPI_KEY = originalKey;
    }
    global.fetch = originalFetch;
  });

  it("returns empty array when SERPAPI_KEY is not set", async () => {
    delete process.env.SERPAPI_KEY;
    const results = await fetchGoogleScholar("semaglutide cost-effectiveness", 5);
    expect(results).toEqual([]);
  });

  it("throws on SerpAPI rate limits so the dispatcher can record failure", async () => {
    process.env.SERPAPI_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limit",
    });
    await expect(
      fetchGoogleScholar("semaglutide cost-effectiveness", 5),
    ).rejects.toThrow(/SerpAPI 429/);
  });

  it("throws on SerpAPI 200 error payloads", async () => {
    process.env.SERPAPI_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "Your searches are rate limited." }),
    });
    await expect(
      fetchGoogleScholar("semaglutide cost-effectiveness", 5),
    ).rejects.toThrow(/Your searches are rate limited/);
  });
});
