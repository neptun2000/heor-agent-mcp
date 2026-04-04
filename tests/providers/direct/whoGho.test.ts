import { fetchWhoGho } from "../../../src/providers/direct/whoGho.js";

describe("fetchWhoGho", () => {
  it("returns empty array on fetch error", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const results = await fetchWhoGho("mortality", 5);
    expect(results).toEqual([]);
    global.fetch = originalFetch;
  });

  it("maps response to LiteratureResult array", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            IndicatorCode: "WHOSIS_000001",
            SpatialDim: "GBR",
            TimeDim: "2020",
            NumericValue: 81.2,
            Value: "81.2",
          },
          {
            IndicatorCode: "WHOSIS_000001",
            SpatialDim: "USA",
            TimeDim: "2020",
            NumericValue: 77.0,
            Value: "77.0",
          },
        ],
      }),
    });
    const results = await fetchWhoGho("life expectancy", 10);
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe("who_gho");
    expect(results[0].abstract).toContain("81.2");
    expect(results[0].authors).toContain("World Health Organization");
    global.fetch = originalFetch;
  });
});
