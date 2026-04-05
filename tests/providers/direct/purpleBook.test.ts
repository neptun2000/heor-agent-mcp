import { fetchPurpleBook } from "../../../src/providers/direct/purpleBook.js";

describe("fetchPurpleBook", () => {
  it("returns fallback results on fetch error", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const results = await fetchPurpleBook("adalimumab", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("purple_book");
    expect(results[0].url).toContain("purplebooksearch.fda.gov");
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
