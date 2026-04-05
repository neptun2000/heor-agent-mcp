import { fetchHitap } from "../../../src/providers/direct/hitap.js";

describe("fetchHitap", () => {
  it("returns structured reference results", async () => {
    const results = await fetchHitap("diabetes", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("hitap");
  });

  it("respects maxResults", async () => {
    const results = await fetchHitap("test", 1);
    expect(results.length).toBe(1);
  });
});
