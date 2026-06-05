import { fetchCmsNadac } from "../../../src/providers/direct/cmsNadac.js";

describe("fetchCmsNadac", () => {
  it("throws on CMS API errors so the dispatcher can record failure", async () => {
    const orig = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad filter",
    });
    await expect(fetchCmsNadac("insulin", 5)).rejects.toThrow(
      /CMS NADAC API 400/,
    );
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
    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get("filter[NDC Description][condition][path]")).toBe(
      "NDC Description",
    );
    expect(url.searchParams.get("filter[NDC Description][condition][value]")).toBe(
      "INSULIN",
    );
    expect(results.length).toBe(1);
    expect(results[0].source).toBe("cms_nadac");
    expect(results[0].abstract).toContain("17.25");
    global.fetch = orig;
  });
});
