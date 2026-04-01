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
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ esearchresult: { idlist: [], count: "0" } }),
      });
    const results = await fetchPubMed("xyzzy nonexistent", 20);
    expect(results).toEqual([]);
  });

  it("returns empty array on fetch error", async () => {
    (global.fetch as jest.Mock).mockReset().mockRejectedValueOnce(new Error("Network error"));
    const results = await fetchPubMed("semaglutide", 20);
    expect(results).toEqual([]);
  });
});
