import { fetchCadthReviews } from "../../../src/providers/direct/cadthReviews.js";

describe("fetchCadthReviews", () => {
  it("returns structured reference results", async () => {
    const results = await fetchCadthReviews("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("cadth_reviews");
  });

  it("respects maxResults", async () => {
    const results = await fetchCadthReviews("test", 1);
    expect(results.length).toBe(1);
  });
});
