/**
 * Tests for hta_workflow — end-to-end HTA submission orchestrator.
 * See design log #17.
 *
 * Strategy: inject mock handlers via the deps interface so we can
 * verify orchestration logic (sequencing, fallbacks, summary table,
 * URL extraction) without depending on live PubMed/CT.gov network calls.
 * Production wiring is exercised in the smoke test (bench/runs/).
 */
import { runHtaWorkflow } from "../../src/tools/htaWorkflow.js";

interface RawResult {
  content: string;
  workflow_summary?: {
    total_ms: number;
    phase_timings_ms: Record<string, number>;
    n_records_searched: number;
    n_records_screened: number;
    n_urls_validated: number;
    url_validation_counts: {
      working: number;
      broken: number;
      browser_only: number;
    };
  };
}

// ---- Fixtures -----------------------------------------------------------

const SAMPLE_RECORDS = [
  {
    id: "pubmed_1",
    source: "pubmed",
    title: "Drug X for Indication Y",
    authors: ["Smith J"],
    date: "2024",
    study_type: "rct",
    abstract: "Randomized trial of Drug X.",
    url: "https://pubmed.ncbi.nlm.nih.gov/00000001/",
  },
  {
    id: "ct_1",
    source: "clinicaltrials",
    title: "NCT01234567",
    authors: [],
    date: "2024",
    study_type: "rct",
    abstract: "Phase 3 trial.",
    url: "https://clinicaltrials.gov/study/NCT01234567",
  },
];

function makeDeps(
  opts: {
    literatureFails?: boolean;
    screenFails?: boolean;
    robFails?: boolean;
    ceFails?: boolean;
    dossierFails?: boolean;
    validateFails?: boolean;
    records?: typeof SAMPLE_RECORDS;
  } = {},
) {
  const records = opts.records ?? SAMPLE_RECORDS;
  return {
    literatureSearch: async () => {
      if (opts.literatureFails) throw new Error("lit search failed");
      return { content: JSON.stringify({ results: records }) };
    },
    screenAbstracts: async () => {
      if (opts.screenFails) throw new Error("screen failed");
      return { content: JSON.stringify({ results: records }) };
    },
    riskOfBias: async () => {
      if (opts.robFails) throw new Error("rob failed");
      return {
        content: JSON.stringify({
          summary: {
            n_assessed: records.length,
            rob2_count: 2,
            robins_i_count: 0,
            amstar2_count: 0,
            rob_judgment: "Low",
          },
          studies: records.map((r) => ({ id: r.id, overall: "Low" })),
        }),
      };
    },
    costEffectivenessModel: async () => {
      if (opts.ceFails) throw new Error("ce failed");
      return {
        content: JSON.stringify({
          base_case: {
            icer: 4321.5,
            delta_cost: 1234,
            delta_qaly: 0.5,
          },
        }),
      };
    },
    htaDossier: async () => {
      if (opts.dossierFails) throw new Error("dossier failed");
      return {
        content:
          "## NICE STA Dossier Draft\n" +
          "**Drug:** drugX\n" +
          "Reference: https://www.nice.org.uk/guidance/ta679",
      };
    },
    validateLinks: async () => {
      if (opts.validateFails) throw new Error("validate failed");
      return {
        content: JSON.stringify({
          summary: { working: 3, browser_only: 0, broken: 0, total: 3 },
        }),
      };
    },
  };
}

async function run(input: Record<string, unknown>, deps = makeDeps()) {
  return (await runHtaWorkflow(input, deps)) as unknown as RawResult;
}

// ---- Schema validation --------------------------------------------------

describe("hta_workflow — schema validation", () => {
  it("requires drug and indication", async () => {
    await expect(run({} as Record<string, unknown>)).rejects.toThrow(
      /required|drug|indication/i,
    );
  });

  it("accepts the minimal valid input", async () => {
    const r = await run({ drug: "drugX", indication: "Y" });
    expect(r.content).toMatch(/HTA Submission Workflow/);
    expect(r.workflow_summary?.total_ms).toBeGreaterThanOrEqual(0);
  });

  it("rejects unknown hta_body with did-you-mean", async () => {
    await expect(
      run({ drug: "drugX", indication: "Y", hta_body: "ncie" as never }),
    ).rejects.toThrow(/hta_body|nice/i);
  });

  it("rejects unknown perspective", async () => {
    await expect(
      run({ drug: "drugX", indication: "Y", perspective: "uk" as never }),
    ).rejects.toThrow(/perspective|nhs/i);
  });
});

// ---- Pipeline sequencing -----------------------------------------------

describe("hta_workflow — pipeline sequencing", () => {
  it("runs all 6 phases by default", async () => {
    const r = await run({ drug: "drugX", indication: "Y" });
    // Pipeline summary table mentions all six phases
    expect(r.content).toMatch(/literature_search/);
    expect(r.content).toMatch(/screen_abstracts/);
    expect(r.content).toMatch(/risk_of_bias/);
    expect(r.content).toMatch(/cost_effectiveness_model/);
    expect(r.content).toMatch(/hta_dossier/);
    expect(r.content).toMatch(/validate_links/);
  });

  it("skips CE model phase when skip_ce_model=true", async () => {
    const r = await run({
      drug: "drugX",
      indication: "Y",
      skip_ce_model: true,
    });
    expect(r.content).toMatch(/skipped/);
    // CE phase timing should be missing/zero
    expect(
      r.workflow_summary?.phase_timings_ms?.cost_effectiveness_model ?? 0,
    ).toBe(0);
  });

  it("returns workflow_summary with phase timings", async () => {
    const r = await run({ drug: "drugX", indication: "Y" });
    expect(r.workflow_summary).toBeDefined();
    expect(
      r.workflow_summary?.phase_timings_ms?.literature_search,
    ).toBeGreaterThanOrEqual(0);
    expect(
      r.workflow_summary?.phase_timings_ms?.hta_dossier,
    ).toBeGreaterThanOrEqual(0);
  });

  it("includes URL validation table when URLs are present", async () => {
    const r = await run({ drug: "drugX", indication: "Y" });
    expect(r.content).toMatch(/URL validation report/);
  });
});

// ---- Fault tolerance ---------------------------------------------------

describe("hta_workflow — fault tolerance (safe-run)", () => {
  it("continues when literature_search fails", async () => {
    const r = await run(
      { drug: "drugX", indication: "Y" },
      makeDeps({ literatureFails: true }),
    );
    // Should still produce output, with a warning in the audit
    expect(r.content).toMatch(/HTA Submission Workflow/);
    expect(r.content).toMatch(/Warnings/i);
    expect(r.content).toMatch(/literature_search.*failed|Phase 1.*failed/i);
  });

  it("continues when CE model fails", async () => {
    const r = await run(
      { drug: "drugX", indication: "Y" },
      makeDeps({ ceFails: true }),
    );
    expect(r.content).toMatch(/HTA Submission Workflow/);
    expect(r.content).toMatch(
      /cost_effectiveness_model.*failed|Phase 4.*failed/i,
    );
  });

  it("continues when dossier fails", async () => {
    const r = await run(
      { drug: "drugX", indication: "Y" },
      makeDeps({ dossierFails: true }),
    );
    expect(r.content).toMatch(/HTA Submission Workflow/);
    expect(r.content).toMatch(/dossier.*failed|Phase 5.*failed/i);
  });

  it("continues when validate_links fails", async () => {
    const r = await run(
      { drug: "drugX", indication: "Y" },
      makeDeps({ validateFails: true }),
    );
    expect(r.content).toMatch(/HTA Submission Workflow/);
  });
});

// ---- Output structure --------------------------------------------------

describe("hta_workflow — output structure", () => {
  it("includes the dossier draft as the primary artifact", async () => {
    const r = await run({ drug: "drugX", indication: "Y" });
    expect(r.content).toMatch(/NICE STA Dossier Draft/);
  });

  it("scans dossier output for URLs and validates them", async () => {
    const r = await run({ drug: "drugX", indication: "Y" });
    expect(r.workflow_summary?.n_urls_validated).toBeGreaterThan(0);
  });

  it("returns the audit record with assumption + warning lines", async () => {
    const r = await run({ drug: "drugX", indication: "Y" });
    expect(r.content).toMatch(/Assumptions/);
    expect(r.content).toMatch(/Total pipeline time/);
  });
});

// ---- Performance --------------------------------------------------------

describe("hta_workflow — performance", () => {
  it("orchestration overhead is well under 1 second with mocked deps", async () => {
    const start = Date.now();
    await run({ drug: "drugX", indication: "Y" });
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

// ---- v1.4.2 code-review regression tests ───────────────────────────────

import { htaWorkflowToolSchema as htaWorkflowSchemaForTests } from "../../src/tools/htaWorkflow.js";

describe("hta_workflow — v1.4.2 fixes", () => {
  it("hta_body='jca' emits an explicit JCA-scope-bypass warning", async () => {
    const r = await run({
      drug: "drugX",
      indication: "Y",
      hta_body: "jca",
      submission_type: "initial",
    });
    expect(r.content).toMatch(
      /JCA scope|jca_pico_scope|verify the indication is actually in JCA scope/i,
    );
  });

  it("pipeline summary table shows 'FAILED' (not 'draft') when dossier phase fails", async () => {
    const r = await run(
      { drug: "x", indication: "y" },
      makeDeps({ dossierFails: true }),
    );
    // The summary table row for Phase 5 must say "FAILED", not "draft"
    expect(r.content).toMatch(/\| 5 \| hta_dossier \|.*FAILED/);
  });

  it("idempotentHint is false (PSA stochastic + live external APIs)", () => {
    expect(htaWorkflowSchemaForTests.annotations.idempotentHint).toBe(false);
  });

  it("openWorldHint is true (calls external PubMed/CT/validate_links HTTP)", () => {
    expect(htaWorkflowSchemaForTests.annotations.openWorldHint).toBe(true);
  });

  it("phase_timings_ms.cost_effectiveness_model is undefined when skip_ce_model=true", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      skip_ce_model: true,
    });
    expect(
      r.workflow_summary?.phase_timings_ms.cost_effectiveness_model,
    ).toBeUndefined();
  });

  it("screen_abstracts → risk_of_bias preserves the abstract field on screened records", async () => {
    // Stub screen to return JSON with screening_status but NO abstract field
    // (matches the real screenAbstracts JSON output shape).
    // Stub risk_of_bias to record what it received in `studies`.
    const robReceivedStudies: Array<{ id?: string; abstract?: string }> = [];
    const customDeps = {
      ...makeDeps(),
      screenAbstracts: async (_args: unknown) => ({
        content: JSON.stringify([
          { id: "pubmed_1", screening_status: "include" },
          { id: "ct_1", screening_status: "include" },
        ]),
      }),
      riskOfBias: async (args: unknown) => {
        const a = args as {
          studies?: Array<{ id?: string; abstract?: string }>;
        };
        for (const s of a.studies ?? []) robReceivedStudies.push(s);
        return {
          content: JSON.stringify({
            summary: {
              n_assessed: 2,
              rob2_count: 2,
              robins_i_count: 0,
              amstar2_count: 0,
              rob_judgment: "Low",
            },
            studies: [],
          }),
        };
      },
    };

    await run(
      { drug: "x", indication: "y" },
      customDeps as unknown as ReturnType<typeof makeDeps>,
    );

    // Each record passed to RoB must have a non-empty abstract — the
    // original literature_search abstracts must survive Phase 2's JSON
    // re-mapping. Pre-v1.4.2 this would receive abstracts as empty strings.
    expect(robReceivedStudies.length).toBeGreaterThan(0);
    for (const s of robReceivedStudies) {
      expect(s.abstract).toBeDefined();
      expect((s.abstract ?? "").length).toBeGreaterThan(0);
    }
  });
});
