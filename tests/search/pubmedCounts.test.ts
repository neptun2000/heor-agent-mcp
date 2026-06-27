import { fetchPubmedLineCounts } from "../../src/search/pubmedCounts.js";

describe("fetchPubmedLineCounts", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns the esearch count per line", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ esearchresult: { count: "26906", idlist: [] } }),
    })) as unknown as typeof fetch;
    const counts = await fetchPubmedLineCounts(['"adrenal insufficiency"[MeSH]']);
    expect(counts).toEqual([26906]);
  });

  it("returns undefined for a line on network failure (never throws)", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const counts = await fetchPubmedLineCounts(["anything"]);
    expect(counts).toEqual([undefined]);
  });
});