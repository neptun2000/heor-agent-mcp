import { fetchIspor } from "../../../src/providers/direct/ispor.js";

describe("fetchIspor", () => {
  it("returns structured reference results", async () => {
    const results = await fetchIspor("cost-effectiveness semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("ispor");
  });

  it("respects maxResults", async () => {
    const results = await fetchIspor("test", 1);
    expect(results.length).toBe(1);
  });
});
