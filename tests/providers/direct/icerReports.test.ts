import { fetchIcerReports } from "../../../src/providers/direct/icerReports.js";

describe("fetchIcerReports", () => {
  it("returns structured reference results", async () => {
    const results = await fetchIcerReports("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("icer_reports");
  });

  it("respects maxResults", async () => {
    const results = await fetchIcerReports("test", 1);
    expect(results.length).toBe(1);
  });
});
