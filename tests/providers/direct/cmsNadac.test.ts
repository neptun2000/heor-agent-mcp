import { fetchCmsNadac } from "../../../src/providers/direct/cmsNadac.js";

describe("fetchCmsNadac", () => {
  it("returns fallback results on fetch error", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));
    const results = await fetchCmsNadac("insulin", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("cms_nadac");
    global.fetch = orig;
  });

  it("maps real API response when available", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { "NDC Description": "INSULIN GLARGINE", "NDC": "00088250033", "NADAC Per Unit": "17.25", "Effective Date": "2025-01-01", "Pricing Unit": "ML", "Pharmacy Type Indicator": "C/I", "Classification for Rate Setting": "B" },
      ],
    });
    const results = await fetchCmsNadac("insulin", 5);
    expect(results.length).toBe(1);
    expect(results[0].source).toBe("cms_nadac");
    expect(results[0].abstract).toContain("17.25");
    global.fetch = orig;
  });
});
