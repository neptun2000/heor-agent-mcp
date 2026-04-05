import { fetchIhmeGbd } from "../../../src/providers/direct/ihmeGbd.js";

describe("fetchIhmeGbd", () => {
  it("returns fallback results on fetch error", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));
    const results = await fetchIhmeGbd("diabetes", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("ihme_gbd");
    expect(results[0].authors).toContain(
      "Institute for Health Metrics and Evaluation (IHME)",
    );
    global.fetch = orig;
  });

  it("returns fallback results on non-JSON response", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html>Not JSON</html>",
    });
    const results = await fetchIhmeGbd("cancer", 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results[0].source).toBe("ihme_gbd");
    expect(results[0].abstract).toContain("cancer");
    global.fetch = orig;
  });

  it("returns fallback results when API returns non-ok status", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    const results = await fetchIhmeGbd("cardiovascular disease", 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("ihme_gbd");
    global.fetch = orig;
  });

  it("respects maxResults for fallback", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));
    const results = await fetchIhmeGbd("diabetes", 1);
    expect(results.length).toBeLessThanOrEqual(1);
    global.fetch = orig;
  });

  it("parses valid JSON results from API", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          results: [
            {
              title: "GBD Diabetes Study",
              year: "2021",
              snippet: "DALYs for diabetes",
              link: "https://ghdx.healthdata.org/record/1",
            },
          ],
        }),
    });
    const results = await fetchIhmeGbd("diabetes", 5);
    expect(results.length).toBe(1);
    expect(results[0].source).toBe("ihme_gbd");
    expect(results[0].title).toBe("GBD Diabetes Study");
    global.fetch = orig;
  });
});
