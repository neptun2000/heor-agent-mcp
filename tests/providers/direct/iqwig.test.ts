import { fetchIqwig } from "../../../src/providers/direct/iqwig.js";

describe("fetchIqwig", () => {
  it("returns structured reference results", async () => {
    const results = await fetchIqwig("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("iqwig");
  });

  it("respects maxResults", async () => {
    const results = await fetchIqwig("test", 1);
    expect(results.length).toBe(1);
  });
});
