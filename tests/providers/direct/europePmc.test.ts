import { fetchEuropePmc } from "../../../src/providers/direct/europePmc.js";

const mockResponse = {
  hitCount: 2,
  resultList: {
    result: [
      {
        id: "38012345",
        source: "MED",
        pmid: "38012345",
        doi: "10.1056/NEJMoa1114287",
        title: "Dimethyl fumarate in relapsing-remitting multiple sclerosis (DEFINE)",
        authorString: "Gold R, Kappos L, Arnold DL.",
        pubYear: "2012",
        pubType: "research-article",
        abstractText:
          "Mean baseline EDSS was 2.4 and the annualised relapse rate was 1.3.",
      },
      {
        id: "PPR123",
        source: "PPR",
        title: "Glatiramer acetate comparative effectiveness preprint",
        authorString: "Comi G.",
        pubYear: "2021",
        pubType: "preprint",
        abstractText: "Observational comparison.",
      },
    ],
  },
};

global.fetch = jest.fn();

describe("fetchEuropePmc", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });
  });
  afterEach(() => jest.clearAllMocks());

  it("returns LiteratureResult array tagged europe_pmc", async () => {
    const results = await fetchEuropePmc("dimethyl fumarate multiple sclerosis", 5);
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe("europe_pmc");
    expect(results[0].title).toMatch(/DEFINE/);
    expect(results[0].date).toBe("2012");
    expect(results[0].abstract).toMatch(/EDSS/);
  });

  it("prefers the DOI for the URL, splits the author string", async () => {
    const results = await fetchEuropePmc("x", 5);
    expect(results[0].url).toBe("https://doi.org/10.1056/NEJMoa1114287");
    expect(results[0].authors).toEqual(["Gold R", "Kappos L", "Arnold DL"]);
  });

  it("falls back to a Europe PMC article URL when no DOI/PMID", async () => {
    const results = await fetchEuropePmc("x", 5);
    expect(results[1].url).toContain("europepmc.org/article/PPR/PPR123");
  });

  it("throws on API errors so the dispatcher records failure", async () => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    });
    await expect(fetchEuropePmc("x", 5)).rejects.toThrow(/\[Europe PMC\] API 503/);
  });
});
