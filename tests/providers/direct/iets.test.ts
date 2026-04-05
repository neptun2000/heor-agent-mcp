import { fetchIets } from "../../../src/providers/direct/iets.js";

describe("fetchIets", () => {
  it("returns structured reference results", async () => {
    const results = await fetchIets("diabetes", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("iets");
  });

  it("respects maxResults", async () => {
    const results = await fetchIets("test", 1);
    expect(results.length).toBe(1);
  });
});
