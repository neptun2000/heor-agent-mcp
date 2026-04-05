import { fetchAnvisa } from "../../../src/providers/direct/anvisa.js";

describe("fetchAnvisa", () => {
  it("returns structured reference results", async () => {
    const results = await fetchAnvisa("diabetes", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("anvisa");
  });

  it("respects maxResults", async () => {
    const results = await fetchAnvisa("test", 1);
    expect(results.length).toBe(1);
  });
});
