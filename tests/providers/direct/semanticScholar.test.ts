import { fetchSemanticScholar } from "../../../src/providers/direct/semanticScholar.js";

const mockResponse = {
  total: 2,
  data: [
    {
      paperId: "d8f76a1d965a26838d53311390cf61b237cb9297",
      title: "Dimethyl fumarate in relapsing-remitting MS",
      year: 2012,
      authors: [{ name: "R Gold" }, { name: "L Kappos" }],
      abstract: "Baseline EDSS and relapse rate were balanced.",
      externalIds: { DOI: "10.1056/NEJMoa1114287", PubMed: "22992073" },
      publicationTypes: ["JournalArticle", "RandomizedControlledTrial"],
      url: "https://www.semanticscholar.org/paper/d8f76a1d",
    },
    {
      paperId: "abc123",
      title: "Preprint without DOI",
      year: 2021,
      authors: [],
      abstract: null,
      externalIds: {},
      publicationTypes: null,
      url: "https://www.semanticscholar.org/paper/abc123",
    },
  ],
};

global.fetch = jest.fn();

describe("fetchSemanticScholar", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });
  });
  afterEach(() => jest.clearAllMocks());

  it("returns LiteratureResult array tagged semantic_scholar", async () => {
    const r = await fetchSemanticScholar("dimethyl fumarate", 5);
    expect(r).toHaveLength(2);
    expect(r[0].source).toBe("semantic_scholar");
    expect(r[0].title).toMatch(/relapsing-remitting/);
    expect(r[0].date).toBe("2012");
    expect(r[0].authors).toEqual(["R Gold", "L Kappos"]);
    expect(r[0].study_type).toBe("JournalArticle");
  });

  it("uses the DOI URL when present, else the S2 url", async () => {
    const r = await fetchSemanticScholar("x", 5);
    expect(r[0].url).toBe("https://doi.org/10.1056/NEJMoa1114287");
    expect(r[1].url).toBe("https://www.semanticscholar.org/paper/abc123");
  });

  it("throws on API errors", async () => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValueOnce({
      ok: false,
      status: 504,
      text: async () => "gateway timeout",
    });
    await expect(fetchSemanticScholar("x", 5)).rejects.toThrow(
      /\[Semantic Scholar\] API 504/,
    );
  });
});
