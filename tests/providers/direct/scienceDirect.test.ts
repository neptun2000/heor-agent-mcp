import { fetchScienceDirect } from "../../../src/providers/direct/scienceDirect.js";

describe("fetchScienceDirect", () => {
  const originalKey = process.env.ELSEVIER_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ELSEVIER_API_KEY;
    } else {
      process.env.ELSEVIER_API_KEY = originalKey;
    }
    global.fetch = originalFetch;
  });

  it("returns empty array when ELSEVIER_API_KEY is not set", async () => {
    delete process.env.ELSEVIER_API_KEY;
    const results = await fetchScienceDirect("semaglutide", 5);
    expect(results).toEqual([]);
  });

  it("strips parentheses, boolean operators, and quotes before querying Elsevier", async () => {
    process.env.ELSEVIER_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ "search-results": { entry: [] } }),
    });

    await fetchScienceDirect(
      'tirzepatide (obesity OR overweight) AND "cost-effectiveness"',
      5,
    );

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get("query")).toBe(
      "tirzepatide obesity overweight cost-effectiveness",
    );
  });

  it("throws on Elsevier API errors so the dispatcher can record failure", async () => {
    process.env.ELSEVIER_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Error translating query",
    });

    await expect(fetchScienceDirect("tirzepatide (obesity)", 5)).rejects.toThrow(
      /ScienceDirect API 400/,
    );
  });
});
