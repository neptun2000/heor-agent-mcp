import { fetchInesss } from "../../../src/providers/direct/inesss.js";

describe("fetchInesss", () => {
  it("returns structured reference results", async () => {
    const results = await fetchInesss("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("inesss");
  });

  it("respects maxResults", async () => {
    const results = await fetchInesss("test", 1);
    expect(results.length).toBe(1);
  });
});
