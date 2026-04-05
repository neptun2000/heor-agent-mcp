import { fetchPssru } from "../../../src/providers/direct/pssru.js";

describe("fetchPssru", () => {
  it("returns structured reference results", async () => {
    const results = await fetchPssru("hospital day case", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("pssru");
    expect(results[0].url).toContain("pssru");
  });

  it("respects maxResults", async () => {
    const results = await fetchPssru("test", 1);
    expect(results.length).toBe(1);
  });
});
