import { fetchHasTc } from "../../../src/providers/direct/hasTc.js";

describe("fetchHasTc", () => {
  it("returns structured reference results", async () => {
    const results = await fetchHasTc("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("has_tc");
  });

  it("respects maxResults", async () => {
    const results = await fetchHasTc("test", 1);
    expect(results.length).toBe(1);
  });
});
