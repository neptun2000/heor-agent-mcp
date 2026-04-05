import { fetchAifa } from "../../../src/providers/direct/aifa.js";

describe("fetchAifa", () => {
  it("returns structured reference results", async () => {
    const results = await fetchAifa("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("aifa");
  });

  it("respects maxResults", async () => {
    const results = await fetchAifa("test", 1);
    expect(results.length).toBe(1);
  });
});
