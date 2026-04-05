import { fetchPbsSchedule } from "../../../src/providers/direct/pbsSchedule.js";

describe("fetchPbsSchedule", () => {
  it("returns structured reference results", async () => {
    const results = await fetchPbsSchedule("pembrolizumab", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("pbs_schedule");
    expect(results[0].url).toContain("pbs");
  });

  it("respects maxResults", async () => {
    const results = await fetchPbsSchedule("test", 1);
    expect(results.length).toBe(1);
  });
});
