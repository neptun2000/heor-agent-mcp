import {
  extractBiorxivKeywords,
  fetchBiorxiv,
} from "../../../src/providers/direct/biorxiv.js";

const mockResponse = {
  collection: [
    {
      doi: "10.1101/2024.01.01.123456",
      title: "Cost-effectiveness of semaglutide in obesity treatment",
      authors: "Smith J; Jones A",
      date: "2024-01-15",
      abstract:
        "Background: Semaglutide, a GLP-1 receptor agonist, for obesity...",
      category: "health economics",
    },
  ],
};

global.fetch = jest.fn();

describe("fetchBiorxiv", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it("returns LiteratureResult array from bioRxiv", async () => {
    const results = await fetchBiorxiv("semaglutide", 20);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("biorxiv");
    expect(results[0].title).toContain("semaglutide");
    expect(results[0].url).toContain("10.1101");
  });

  it("tokenizes boolean/grouped queries into searchable keywords", () => {
    expect(
      extractBiorxivKeywords("tirzepatide (obesity OR overweight)"),
    ).toEqual(["tirzepatide", "obesity", "overweight"]);
  });

  it("matches boolean/grouped queries by any significant keyword", async () => {
    const results = await fetchBiorxiv(
      "tirzepatide (obesity OR overweight)",
      20,
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toContain("obesity");
  });

  it("throws on API errors so the dispatcher can record failure", async () => {
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "rate limit",
      });
    await expect(fetchBiorxiv("semaglutide", 20)).rejects.toThrow(
      /bioRxiv API 429/,
    );
  });

  it("propagates fetch errors", async () => {
    (global.fetch as jest.Mock)
      .mockReset()
      .mockRejectedValueOnce(new Error("fail"));
    await expect(fetchBiorxiv("semaglutide", 20)).rejects.toThrow("fail");
  });
});
