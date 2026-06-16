import { fetchOecd } from "../../../src/providers/direct/oecd.js";

describe("fetchOecd", () => {
  it("throws on API errors so the dispatcher can record failure", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    });
    await expect(fetchOecd("health expenditure", 5)).rejects.toThrow(
      /\[OECD\] API 503/,
    );
    global.fetch = orig;
  });

  it("maps SDMX response to results", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        dataSets: [{ observations: { "0:0": [9.8], "1:0": [17.1] } }],
        structure: {
          dimensions: {
            observation: [
              {
                id: "REF_AREA",
                values: [
                  { id: "GBR", name: "United Kingdom" },
                  { id: "USA", name: "United States" },
                ],
              },
              { id: "TIME_PERIOD", values: [{ id: "2022" }] },
            ],
          },
        },
      }),
    });
    const results = await fetchOecd("health expenditure", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("oecd");
    expect(results[0].authors).toContain("OECD");
    global.fetch = orig;
  });

  it("returns empty array when dimensions are missing", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        dataSets: [{ observations: {} }],
        structure: { dimensions: { observation: [] } },
      }),
    });
    const results = await fetchOecd("obesity", 5);
    expect(results).toEqual([]);
    global.fetch = orig;
  });

  it("uses default dataset when query has no matching keyword", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        dataSets: [{ observations: {} }],
        structure: {
          dimensions: {
            observation: [
              { id: "REF_AREA", values: [] },
              { id: "TIME_PERIOD", values: [] },
            ],
          },
        },
      }),
    });
    const results = await fetchOecd("some unknown query", 5);
    expect(results).toEqual([]);
    global.fetch = orig;
  });
});
