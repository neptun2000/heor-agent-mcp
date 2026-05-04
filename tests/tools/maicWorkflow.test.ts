/**
 * Tests for the maic_workflow orchestration tool.
 *
 * Background. ChatGPT-5.3 cannot reliably chain 5+ tool calls in parallel
 * for a full MAIC pipeline (a tool-agency limitation). Claude Sonnet 4.6
 * can, but each round-trip costs latency. maic_workflow runs the canonical
 * pipeline server-side in one MCP call:
 *
 *   Phase 1 (parallel): itc_feasibility + broad literature_search
 *   Phase 2 (parallel): per-trial literature_searches (if trial names given)
 *   Phase 3 (sequential): screen_abstracts on combined results
 *   Phase 4 (parallel): risk_of_bias + evidence_network
 *
 * The tool is deps-injectable so tests can mock the underlying handlers.
 */
import {
  runMaicWorkflow,
  type MaicWorkflowDeps,
} from "../../src/tools/maicWorkflow.js";

// ---- helpers -----------------------------------------------------------

function ok(content: unknown) {
  return {
    content,
    audit: {
      tool: "x",
      timestamp: new Date().toISOString(),
      query: {},
      sources_queried: [],
      methodology: "",
      inclusions: 0,
      exclusions: [],
      assumptions: [],
      warnings: [],
      output_format: "text",
    },
  };
}

function makeStubDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const wrap =
    (name: string, retVal: unknown = ok(`# ${name} stub output`)) =>
    async (args: unknown) => {
      calls.push({ name, args });
      return retVal;
    };
  return {
    deps: {
      itcFeasibility: wrap("itcFeasibility"),
      literatureSearch: wrap(
        "literatureSearch",
        ok(
          "## Literature\n- Study A (RCT, n=300, NEJM 2024) — pubmed:12345\n- Study B (RCT, n=420) — pubmed:67890",
        ),
      ),
      screenAbstracts: wrap(
        "screenAbstracts",
        ok("## Screening\n- Study A: include\n- Study B: include"),
      ),
      riskOfBias: wrap(
        "riskOfBias",
        ok("## Risk of Bias\n| Study | Overall |\n|-|-|\n| A | Low |"),
      ),
      evidenceNetwork: wrap(
        "evidenceNetwork",
        ok("## Network\nFeasible: yes\nNodes: 3, Edges: 2"),
      ),
      ...overrides,
    } as MaicWorkflowDeps,
    calls,
  };
}

// ---- schema validation -------------------------------------------------

describe("maic_workflow — schema validation", () => {
  it("requires intervention, comparator, indication", async () => {
    const { deps } = makeStubDeps();
    await expect(
      runMaicWorkflow({ intervention: "guselkumab" } as never, deps),
    ).rejects.toThrow(/comparator|indication|required/i);
  });

  it("accepts a minimal valid input", async () => {
    const { deps } = makeStubDeps();
    const r = await runMaicWorkflow(
      {
        intervention: "guselkumab",
        comparator: "risankizumab",
        indication: "ulcerative colitis",
      },
      deps,
    );
    expect(typeof r.content).toBe("string");
    expect(r.audit.tool).toBe("workflow.maic");
  });

  it("rejects an unknown outcome_type via did-you-mean error", async () => {
    const { deps } = makeStubDeps();
    await expect(
      runMaicWorkflow(
        {
          intervention: "x",
          comparator: "y",
          indication: "z",
          outcome_type: "binary_categorical" as never,
        },
        deps,
      ),
    ).rejects.toThrow(/binary|continuous|time_to_event/);
  });
});

// ---- phase orchestration -----------------------------------------------

describe("maic_workflow — phase orchestration", () => {
  it("Phase 1: runs itc_feasibility + broad literature_search in parallel", async () => {
    const { deps, calls } = makeStubDeps();
    await runMaicWorkflow(
      {
        intervention: "guselkumab",
        comparator: "risankizumab",
        indication: "ulcerative colitis",
      },
      deps,
    );

    // both must have run
    const phase1 = calls
      .slice(0, 2)
      .map((c) => c.name)
      .sort();
    expect(phase1).toEqual(["itcFeasibility", "literatureSearch"]);
  });

  it("Phase 2: runs one literature_search per trial name in parallel", async () => {
    const { deps, calls } = makeStubDeps();
    await runMaicWorkflow(
      {
        intervention: "guselkumab",
        comparator: "risankizumab",
        indication: "ulcerative colitis",
        trials_intervention: ["QUASAR", "ASTRO"],
        trials_comparator: ["INSPIRE", "COMMAND"],
      },
      deps,
    );

    // 1 broad + 4 trial-specific = 5 literature_search invocations total
    const litCalls = calls.filter((c) => c.name === "literatureSearch");
    expect(litCalls.length).toBe(5);
    const queries = litCalls.map((c) => (c.args as { query: string }).query);
    expect(queries.some((q) => q.includes("QUASAR"))).toBe(true);
    expect(queries.some((q) => q.includes("INSPIRE"))).toBe(true);
  });

  it("Phase 3: runs screen_abstracts AFTER literature searches complete", async () => {
    const { deps, calls } = makeStubDeps();
    await runMaicWorkflow(
      {
        intervention: "guselkumab",
        comparator: "risankizumab",
        indication: "ulcerative colitis",
      },
      deps,
    );
    const litIdx = calls.findIndex((c) => c.name === "literatureSearch");
    const screenIdx = calls.findIndex((c) => c.name === "screenAbstracts");
    expect(screenIdx).toBeGreaterThan(litIdx);
  });

  it("Phase 4: runs risk_of_bias + evidence_network after screening", async () => {
    const { deps, calls } = makeStubDeps();
    await runMaicWorkflow(
      {
        intervention: "guselkumab",
        comparator: "risankizumab",
        indication: "ulcerative colitis",
      },
      deps,
    );
    const screenIdx = calls.findIndex((c) => c.name === "screenAbstracts");
    const robIdx = calls.findIndex((c) => c.name === "riskOfBias");
    const netIdx = calls.findIndex((c) => c.name === "evidenceNetwork");
    expect(robIdx).toBeGreaterThan(screenIdx);
    expect(netIdx).toBeGreaterThan(screenIdx);
  });

  it("a Phase 4 failure does not abort the whole pipeline", async () => {
    // RoB might fail when screened studies have no usable structure.
    // The workflow must catch and report it, not throw.
    const failingRob = async () => {
      throw new Error("no studies usable for RoB");
    };
    const { deps } = makeStubDeps({ riskOfBias: failingRob });
    const r = await runMaicWorkflow(
      {
        intervention: "x",
        comparator: "y",
        indication: "z",
      },
      deps,
    );
    expect(String(r.content)).toMatch(/risk of bias/i);
    expect(String(r.content)).toMatch(
      /no studies usable for RoB|skipped|error/i,
    );
  });
});

// ---- output structure --------------------------------------------------

describe("maic_workflow — output structure", () => {
  it("emits the canonical 12-section HEOR report", async () => {
    const { deps } = makeStubDeps();
    const r = await runMaicWorkflow(
      {
        intervention: "guselkumab",
        comparator: "risankizumab",
        indication: "ulcerative colitis",
      },
      deps,
    );
    const txt = String(r.content);
    expect(txt).toMatch(/MAIC Workflow/i);
    expect(txt).toMatch(/ITC Feasibility/i);
    expect(txt).toMatch(/Literature/i);
    expect(txt).toMatch(/Screening/i);
    expect(txt).toMatch(/Risk of Bias/i);
    expect(txt).toMatch(/Evidence Network/i);
    expect(txt).toMatch(/Next Steps|Recommendations/i);
    expect(txt).toMatch(/Limitations/i);
  });

  it("explicitly states this tool stops short of running MAIC/Bucher (needs IPD)", async () => {
    // Critical to preserve methodological honesty per CLAUDE.md
    // experimental-labelling rule.
    const { deps } = makeStubDeps();
    const r = await runMaicWorkflow(
      {
        intervention: "x",
        comparator: "y",
        indication: "z",
      },
      deps,
    );
    expect(String(r.content)).toMatch(
      /IPD|individual patient data|effect estimates|requires sponsor/i,
    );
  });

  it("mentions the trial names the user supplied in Limitations or References", async () => {
    const { deps } = makeStubDeps();
    const r = await runMaicWorkflow(
      {
        intervention: "guselkumab",
        comparator: "risankizumab",
        indication: "ulcerative colitis",
        trials_intervention: ["QUASAR"],
        trials_comparator: ["INSPIRE"],
      },
      deps,
    );
    expect(String(r.content)).toMatch(/QUASAR/);
    expect(String(r.content)).toMatch(/INSPIRE/);
  });
});
