import { fetchAllOfUs } from "../../../src/providers/direct/allOfUs.js";

describe("fetchAllOfUs", () => {
  it("returns empty array on fetch error", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const results = await fetchAllOfUs("diabetes", 5);
    expect(results).toEqual([]);
    global.fetch = originalFetch;
  });

  it("maps response to LiteratureResult array", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            conceptId: 201826,
            conceptName: "Type 2 diabetes mellitus",
            domainId: "Condition",
            vocabularyId: "SNOMED",
            conceptCode: "44054006",
            countValue: 85000,
            prevalence: 0.12,
          },
          {
            conceptId: 4184637,
            conceptName: "HbA1c measurement",
            domainId: "Measurement",
            vocabularyId: "LOINC",
            conceptCode: "4548-4",
            countValue: 320000,
            prevalence: 0.45,
          },
        ],
        totalCount: 2,
      }),
    });
    const results = await fetchAllOfUs("diabetes", 10);
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe("all_of_us");
    expect(results[0].abstract).toContain("85,000");
    expect(results[0].abstract).toContain("12.00%");
    expect(results[0].authors).toContain("NIH All of Us Research Program");
    global.fetch = originalFetch;
  });
});
