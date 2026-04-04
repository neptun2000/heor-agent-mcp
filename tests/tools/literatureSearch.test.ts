import { handleLiteratureSearch } from "../../src/tools/literatureSearch.js";

jest.mock("../../src/providers/factory.js", () => ({
  createProvider: () => ({
    searchLiterature: jest.fn().mockResolvedValue({
      content: "## Literature Search Results\n\n### 1. Test Study",
      audit: {
        tool: "literature_search",
        timestamp: new Date().toISOString(),
        query: { query: "semaglutide" },
        sources_queried: [{ source: "pubmed", query_sent: "semaglutide", results_returned: 5, results_included: 5, latency_ms: 200, status: "ok" }],
        methodology: "PRISMA-style",
        inclusions: 5,
        exclusions: [],
        assumptions: [],
        warnings: [],
        output_format: "text",
      },
    }),
  }),
}));

describe("handleLiteratureSearch", () => {
  it("validates and passes params to provider", async () => {
    const result = await handleLiteratureSearch({ query: "semaglutide" });
    expect(result.content).toContain("Literature Search Results");
    expect(result.audit.tool).toBe("literature_search");
  });

  it("throws on missing query", async () => {
    await expect(handleLiteratureSearch({})).rejects.toThrow();
  });
});
