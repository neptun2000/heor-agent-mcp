import { fetchNhsCosts } from "../../../src/providers/direct/nhsCosts.js";

describe("fetchNhsCosts", () => {
  it("returns structured reference results", async () => {
    const results = await fetchNhsCosts("outpatient attendance", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("nhs_costs");
    expect(results[0].url).toContain("nhs");
  });

  it("respects maxResults", async () => {
    const results = await fetchNhsCosts("test", 1);
    expect(results.length).toBe(1);
  });
});
