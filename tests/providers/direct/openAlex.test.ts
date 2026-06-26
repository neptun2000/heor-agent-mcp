import { fetchOpenAlex } from "../../../src/providers/direct/openAlex.js";

const mockResponse = {
  meta: { count: 2 },
  results: [
    {
      id: "https://openalex.org/W123",
      doi: "https://doi.org/10.1056/NEJMoa1114287",
      display_name: "Dimethyl fumarate in relapsing-remitting MS (DEFINE)",
      publication_year: 2012,
      type: "article",
      authorships: [
        { author: { display_name: "R Gold" } },
        { author: { display_name: "L Kappos" } },
      ],
      abstract_inverted_index: { Mean: [0], baseline: [1], EDSS: [2] },
      primary_location: { landing_page_url: "https://nejm.org/define" },
    },
    {
      id: "https://openalex.org/W456",
      doi: null,
      display_name: "Work without a DOI",
      publication_year: 2020,
      type: "article",
      authorships: [],
      abstract_inverted_index: null,
      primary_location: { landing_page_url: "https://example.org/work" },
    },
  ],
};

global.fetch = jest.fn();

describe("fetchOpenAlex", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });
  });
  afterEach(() => jest.clearAllMocks());

  it("returns LiteratureResult array tagged openalex", async () => {
    const r = await fetchOpenAlex("dimethyl fumarate", 5);
    expect(r).toHaveLength(2);
    expect(r[0].source).toBe("openalex");
    expect(r[0].title).toMatch(/DEFINE/);
    expect(r[0].date).toBe("2012");
    expect(r[0].authors).toEqual(["R Gold", "L Kappos"]);
  });

  it("reconstructs the inverted-index abstract", async () => {
    const r = await fetchOpenAlex("x", 5);
    expect(r[0].abstract).toBe("Mean baseline EDSS");
  });

  it("uses the DOI URL, falls back to the landing page when no DOI", async () => {
    const r = await fetchOpenAlex("x", 5);
    expect(r[0].url).toBe("https://doi.org/10.1056/NEJMoa1114287");
    expect(r[1].url).toBe("https://example.org/work");
  });

  it("throws on API errors", async () => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    });
    await expect(fetchOpenAlex("x", 5)).rejects.toThrow(/\[OpenAlex\] API 429/);
  });
});
