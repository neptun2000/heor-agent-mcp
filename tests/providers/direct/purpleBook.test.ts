import { fetchPurpleBook } from "../../../src/providers/direct/purpleBook.js";

describe("fetchPurpleBook", () => {
  it("throws on openFDA API errors so the dispatcher can record failure", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limit",
    });
    await expect(fetchPurpleBook("adalimumab", 5)).rejects.toThrow(
      /FDA Purple Book API 429/,
    );
    global.fetch = orig;
  });

  it("strips quotes before embedding query text in openFDA Lucene fields", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    await fetchPurpleBook('adalimumab"evil"', 5);
    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    const search = url.searchParams.get("search") ?? "";
    expect(search).not.toContain('adalimumab"evil"');
    expect(search).toContain('openfda.brand_name:"adalimumab evil"');
    global.fetch = orig;
  });

  it("maps openFDA label response to results", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          id: "label-001",
          openfda: {
            brand_name: ["Humira"],
            generic_name: ["adalimumab"],
            manufacturer_name: ["AbbVie Inc."],
            application_number: ["BLA125057"],
          },
          effective_time: "20230101",
          indications_and_usage: ["Treatment of rheumatoid arthritis"],
        }],
      }),
    });
    const results = await fetchPurpleBook("adalimumab", 5);
    expect(results.length).toBe(1);
    expect(results[0].source).toBe("purple_book");
    expect(results[0].title).toContain("BLA125057");
    expect(results[0].abstract).toContain("AbbVie Inc.");
    global.fetch = orig;
  });
});
