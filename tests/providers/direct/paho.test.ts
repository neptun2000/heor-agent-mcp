import { fetchPaho } from "../../../src/providers/direct/paho.js";

describe("fetchPaho", () => {
  it("returns structured reference results", async () => {
    const results = await fetchPaho("diabetes", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("paho");
  });

  it("respects maxResults", async () => {
    const results = await fetchPaho("test", 1);
    expect(results.length).toBe(1);
  });
});
