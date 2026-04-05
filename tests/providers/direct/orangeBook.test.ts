import { fetchOrangeBook } from "../../../src/providers/direct/orangeBook.js";

describe("fetchOrangeBook", () => {
  it("returns empty array on fetch error", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const results = await fetchOrangeBook("semaglutide", 5);
    expect(results).toEqual([]);
    global.fetch = orig;
  });

  it("maps openFDA response to results", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          application_number: "NDA123456",
          sponsor_name: "Acme Pharma",
          products: [{ brand_name: "TestDrug", active_ingredients: [{ name: "semaglutide", strength: "1mg" }], te_code: "AB", dosage_form: "Injection", route: "Subcutaneous" }],
          submissions: [{ submission_type: "ORIG", submission_number: "1", submission_status: "AP", submission_status_date: "2017-12-05" }],
        }],
      }),
    });
    const results = await fetchOrangeBook("semaglutide", 10);
    expect(results.length).toBe(1);
    expect(results[0].source).toBe("orange_book");
    expect(results[0].abstract).toContain("NDA123456");
    expect(results[0].abstract).toContain("AB");
    global.fetch = orig;
  });
});
