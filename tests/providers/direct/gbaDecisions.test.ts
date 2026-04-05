import { fetchGbaDecisions } from "../../../src/providers/direct/gbaDecisions.js";

describe("fetchGbaDecisions", () => {
  it("returns structured reference results", async () => {
    const results = await fetchGbaDecisions("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("gba_decisions");
  });

  it("respects maxResults", async () => {
    const results = await fetchGbaDecisions("test", 1);
    expect(results.length).toBe(1);
  });
});
