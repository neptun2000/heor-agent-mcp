import { fetchBnf } from "../../../src/providers/direct/bnf.js";

describe("fetchBnf", () => {
  it("returns structured reference results", async () => {
    const results = await fetchBnf("metformin", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("bnf");
    expect(results[0].url).toContain("bnf");
  });

  it("respects maxResults", async () => {
    const results = await fetchBnf("test", 1);
    expect(results.length).toBe(1);
  });
});
