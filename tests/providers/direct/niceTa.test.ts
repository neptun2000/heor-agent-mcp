import { fetchNiceTa } from "../../../src/providers/direct/niceTa.js";

describe("fetchNiceTa", () => {
  it("returns structured reference results", async () => {
    const results = await fetchNiceTa("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("nice_ta");
  });

  it("respects maxResults", async () => {
    const results = await fetchNiceTa("test", 1);
    expect(results.length).toBe(1);
  });
});
