import { fetchConitec } from "../../../src/providers/direct/conitec.js";

describe("fetchConitec", () => {
  it("returns structured reference results", async () => {
    const results = await fetchConitec("diabetes", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("conitec");
  });

  it("respects maxResults", async () => {
    const results = await fetchConitec("test", 1);
    expect(results.length).toBe(1);
  });
});
