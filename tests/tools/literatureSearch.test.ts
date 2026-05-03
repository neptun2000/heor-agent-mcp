import { handleLiteratureSearch } from "../../src/tools/literatureSearch.js";

jest.mock("../../src/providers/factory.js", () => ({
  createProvider: () => ({
    searchLiterature: jest.fn().mockResolvedValue({
      content: "## Literature Search Results\n\n### 1. Test Study",
      audit: {
        tool: "literature.search",
        timestamp: new Date().toISOString(),
        query: { query: "semaglutide" },
        sources_queried: [
          {
            source: "pubmed",
            query_sent: "semaglutide",
            results_returned: 5,
            results_included: 5,
            latency_ms: 200,
            status: "ok",
          },
        ],
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
    expect(result.audit.tool).toBe("literature.search");
  });

  it("throws on missing query", async () => {
    await expect(handleLiteratureSearch({})).rejects.toThrow();
  });

  // PostHog showed real-world failures with sources=["heta"] and similar.
  // Macro aliases (hta, hta_eu, etc.) expand one shorthand into the full
  // family of sources — agents can use coarse categories without hallucinating.
  describe("macro aliases (one shorthand → many sources)", () => {
    it("'hta' expands to all 9 HTA appraisal sources", async () => {
      const result = await handleLiteratureSearch({
        query: "x",
        sources: ["hta"],
      });
      expect(result.audit.tool).toBe("literature.search");
      // Should not throw enum validation error
    });

    it("'hta_eu' expands to European HTA bodies (NICE/EMA/IQWiG/HAS/JCA/AIFA/TLV)", async () => {
      await expect(
        handleLiteratureSearch({ query: "x", sources: ["hta_eu"] }),
      ).resolves.not.toThrow();
    });

    it("'hta_us' expands to US HTA bodies (ICER/FDA Orange/Purple Book)", async () => {
      await expect(
        handleLiteratureSearch({ query: "x", sources: ["hta_us"] }),
      ).resolves.not.toThrow();
    });

    it("error message for typo (e.g., 'pumed') suggests 'pubmed'", async () => {
      try {
        await handleLiteratureSearch({ query: "x", sources: ["pumed"] });
        fail("should have thrown");
      } catch (err) {
        expect(String(err)).toMatch(/pubmed/i);
      }
    });
  });
});
