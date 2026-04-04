import { fetchPubMed } from "../../../src/providers/direct/pubmed.js";

const mockEsearchResponse = {
  esearchresult: {
    idlist: ["38012345", "37998765"],
    count: "2",
  },
};

const mockEsummaryResponse = {
  result: {
    uids: ["38012345", "37998765"],
    "38012345": {
      uid: "38012345",
      title: "Semaglutide cost-effectiveness in type 2 diabetes",
      authors: [{ name: "Smith J" }, { name: "Jones A" }],
      pubdate: "2024 Jan",
      source: "Diabetes Care",
      elocationid: "10.2337/dc23-1234",
    },
    "37998765": {
      uid: "37998765",
      title: "GLP-1 receptor agonists: a systematic review",
      authors: [{ name: "Brown K" }],
      pubdate: "2024 Jan",
      source: "BMJ",
      elocationid: "10.1136/bmj.p12345",
    },
  },
};

const mockEfetchXml = `<?xml version="1.0" ?>
<PubmedArticleSet>
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">38012345</PMID>
    <Article>
      <Abstract>
        <AbstractText>This study evaluates the cost-effectiveness of semaglutide in type 2 diabetes patients.</AbstractText>
      </Abstract>
    </Article>
  </MedlineCitation>
</PubmedArticle>
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">37998765</PMID>
    <Article>
      <Abstract>
        <AbstractText Label="BACKGROUND">GLP-1 receptor agonists have shown promise.</AbstractText>
        <AbstractText Label="CONCLUSION">Further research is needed.</AbstractText>
      </Abstract>
    </Article>
  </MedlineCitation>
</PubmedArticle>
</PubmedArticleSet>`;

global.fetch = jest.fn();

describe("fetchPubMed", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockEsearchResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockEsummaryResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => mockEfetchXml,
      });
  });

  afterEach(() => jest.clearAllMocks());

  it("returns LiteratureResult array from PubMed", async () => {
    const results = await fetchPubMed("semaglutide type 2 diabetes", 20);
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe("pubmed");
    expect(results[0].title).toContain("Semaglutide");
    expect(results[0].authors).toContain("Smith J");
    expect(results[0].url).toContain("38012345");
  });

  it("returns empty array when no results", async () => {
    (global.fetch as jest.Mock).mockReset().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ esearchresult: { idlist: [], count: "0" } }),
    });
    const results = await fetchPubMed("xyzzy nonexistent", 20);
    expect(results).toEqual([]);
  });

  it("returns empty array on fetch error", async () => {
    (global.fetch as jest.Mock)
      .mockReset()
      .mockRejectedValueOnce(new Error("Network error"));
    const results = await fetchPubMed("semaglutide", 20);
    expect(results).toEqual([]);
  });

  it("parses abstracts from efetch response", async () => {
    const results = await fetchPubMed("semaglutide type 2 diabetes", 20);
    expect(results).toHaveLength(2);
    expect(results[0].abstract).toBe(
      "This study evaluates the cost-effectiveness of semaglutide in type 2 diabetes patients.",
    );
    expect(results[1].abstract).toBe(
      "GLP-1 receptor agonists have shown promise. Further research is needed.",
    );
  });

  it("returns empty abstract when efetch fails", async () => {
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockEsearchResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockEsummaryResponse,
      })
      .mockRejectedValueOnce(new Error("efetch network error"));
    const results = await fetchPubMed("semaglutide type 2 diabetes", 20);
    expect(results).toHaveLength(2);
    expect(results[0].abstract).toBe("");
    expect(results[1].abstract).toBe("");
  });
});
