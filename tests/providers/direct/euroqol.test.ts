import { fetchEuroqol } from "../../../src/providers/direct/euroqol.js";

describe("fetchEuroqol", () => {
  it("returns EuroQol EQ-5D reference pointers", async () => {
    const results = await fetchEuroqol("UK 5L", 4);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("euroqol");
    expect(results[0].url).toContain("euroqol.org");
  });

  it("includes the value set registry entry", async () => {
    const results = await fetchEuroqol("value set", 4);
    const text = results.map((r) => r.title + r.abstract).join(" ");
    expect(text).toContain("Value Sets");
  });

  it("respects maxResults", async () => {
    const results = await fetchEuroqol("test", 2);
    expect(results).toHaveLength(2);
  });
});
