import { fetchWorldBank } from "../../../src/providers/direct/worldBank.js";

describe("fetchWorldBank", () => {
  it("returns empty array on fetch error", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const results = await fetchWorldBank("gdp", 5);
    expect(results).toEqual([]);
    global.fetch = originalFetch;
  });

  it("maps response to LiteratureResult array", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { page: 1, pages: 1, total: 2 },
        [
          {
            indicator: { id: "NY.GDP.PCAP.PP.CD", value: "GDP per capita, PPP" },
            country: { id: "GBR", value: "United Kingdom" },
            date: "2022",
            value: 49675.3,
          },
          {
            indicator: { id: "NY.GDP.PCAP.PP.CD", value: "GDP per capita, PPP" },
            country: { id: "USA", value: "United States" },
            date: "2022",
            value: 76330.2,
          },
        ],
      ],
    });
    const results = await fetchWorldBank("gdp", 10);
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe("world_bank");
    expect(results[0].abstract).toContain("49675.3");
    expect(results[0].authors).toContain("World Bank");
    global.fetch = originalFetch;
  });
});
