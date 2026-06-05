import { fetchWhoGho } from "../../../src/providers/direct/whoGho.js";

describe("fetchWhoGho", () => {
  it("propagates fetch errors", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    await expect(fetchWhoGho("mortality", 5)).rejects.toThrow("network error");
    global.fetch = originalFetch;
  });

  it("throws on WHO API errors so the dispatcher can record failure", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limit",
    });
    await expect(fetchWhoGho("mortality", 5)).rejects.toThrow(
      /WHO GHO API 429/,
    );
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
    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get("$filter")).toBe("TimeDim ge '2018'");
    expect(url.searchParams.get("$orderby")).toBe("TimeDim desc");
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe("who_gho");
    expect(results[0].abstract).toContain("81.2");
    expect(results[0].authors).toContain("World Health Organization");
    global.fetch = originalFetch;
  });
});
