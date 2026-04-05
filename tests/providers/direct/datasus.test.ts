import { fetchDatasus } from "../../../src/providers/direct/datasus.js";

describe("fetchDatasus", () => {
  it("returns structured reference results", async () => {
    const results = await fetchDatasus("diabetes", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("datasus");
  });

  it("respects maxResults", async () => {
    const results = await fetchDatasus("test", 1);
    expect(results.length).toBe(1);
  });
});
