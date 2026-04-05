import { fetchFonasa } from "../../../src/providers/direct/fonasa.js";

describe("fetchFonasa", () => {
  it("returns structured reference results", async () => {
    const results = await fetchFonasa("diabetes", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("fonasa");
  });

  it("respects maxResults", async () => {
    const results = await fetchFonasa("test", 1);
    expect(results.length).toBe(1);
  });
});
