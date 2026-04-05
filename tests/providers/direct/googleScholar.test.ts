import { fetchGoogleScholar } from "../../../src/providers/direct/googleScholar.js";

describe("fetchGoogleScholar", () => {
  const originalKey = process.env.SERPAPI_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.SERPAPI_KEY;
    } else {
      process.env.SERPAPI_KEY = originalKey;
    }
  });

  it("returns empty array when SERPAPI_KEY is not set", async () => {
    delete process.env.SERPAPI_KEY;
    const results = await fetchGoogleScholar("semaglutide cost-effectiveness", 5);
    expect(results).toEqual([]);
  });

  it("returns empty array on fetch error when key is set", async () => {
    process.env.SERPAPI_KEY = "invalid-test-key";
    // fetch will fail or return non-ok — should return [] gracefully
    const results = await fetchGoogleScholar("semaglutide cost-effectiveness", 5);
    expect(results).toEqual([]);
  });
});
