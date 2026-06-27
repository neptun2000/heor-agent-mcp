import { handleSearchStrategyBuild } from "../../src/tools/searchStrategyBuild.js";

describe("search_strategy_build handler", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ esearchresult: { count: "123", idlist: [] } }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("builds one strategy block per requested strand with a DRAFT Emtree banner", async () => {
    const result = await handleSearchStrategyBuild({
      picos: { condition: "adrenal insufficiency", population: "children" },
      condition_terms: ["adrenal insufficiency", "Addison disease"],
      strands: ["economic", "hrqol"],
      age_limit: "pediatric",
      date_from: "2007-01-01",
    });

    const content = result.content as {
      markdown: string;
      strategy: {
        per_strand: unknown[];
        pipeline_inputs: { pubmed_query: string };
      };
    };

    expect(content.strategy.per_strand).toHaveLength(2);
    expect(content.markdown).toMatch(/DRAFT — verify in Emtree/);
    expect(content.markdown).not.toMatch(/Embase hits.*\d+/i);
    expect(content.strategy.pipeline_inputs.pubmed_query.length).toBeGreaterThan(0);
    expect(result.audit.tool).toBe("search.strategy_build");
  });

  it("fills real PubMed counts from esearch", async () => {
    const result = await handleSearchStrategyBuild({
      condition_terms: ["x"],
      strands: ["epidemiology"],
      run_counts: true,
    });

    const content = result.content as { markdown: string };
    expect(content.markdown).toContain("123");
  });
});