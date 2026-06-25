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
    // V1: disclosure block present for submission-level tool
    expect(r.content).toContain("AI Assistance Disclosure");
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

// ---- Design log #35: placeholder economic inputs ----------------------

describe("hta_workflow — design log #35: placeholder economic inputs", () => {
  it("flags a PLACEHOLDER ICER when ce_inputs are omitted (default)", async () => {
    const r = await run({ drug: "drugX", indication: "Y" });
    expect(r.content).toMatch(/PLACEHOLDER ICER/i);
    expect(r.content).toMatch(/drug_cost_annual/);
  });

  it("SKIPS the CE phase when require_real_ce_inputs=true and inputs are missing", async () => {
    const r = await run({
      drug: "drugX",
      indication: "Y",
      require_real_ce_inputs: true,
    });
    expect(r.content).toMatch(/SKIPPED/);
    expect(r.content).toMatch(/require_real_ce_inputs/);
    // never presents a fabricated ICER
    expect(r.content).not.toMatch(/Deterministic ICER/);
  });

  it("does NOT flag placeholder when real ce_inputs are supplied", async () => {
    const r = await run({
      drug: "drugX",
      indication: "Y",
      ce_inputs: {
        drug_cost_annual: 12000,
        comparator_cost_annual: 3000,
        efficacy_delta: 0.3,
      },
    });
    expect(r.content).not.toMatch(/PLACEHOLDER ICER/i);
    expect(r.content).toMatch(/Deterministic ICER/);
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

// ---- GVD routing + Phase 3.5 ───────────────────────────────────────────

describe("hta_body='gvd'", () => {
  it("emits GVD advisory note in audit", async () => {
    const r = await run({ drug: "X", indication: "Y", hta_body: "gvd" });
    expect(r.content).toMatch(
      /gvd.*pipeline|Global Value Dossier|gvd_evidence_pack/i,
    );
  });

  it("runs all 6 phases with hta_body='gvd'", async () => {
    const r = await run({ drug: "X", indication: "Y", hta_body: "gvd" });
    expect(r.content).toMatch(/Phase 5.*GVD|GVD.*draft|hta_body.*gvd/i);
  });

  it("Phase 3.5 runs when unmet_need_inputs provided for GVD", async () => {
    const mockUnmetNeed = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        unmet_need_summary: "Unmet need is high for Y.",
      }),
    });
    const customDeps = {
      ...makeDeps(),
      evidenceUnmetNeed: mockUnmetNeed,
    };
    const r = await run(
      {
        drug: "X",
        indication: "Y",
        hta_body: "gvd",
        unmet_need_inputs: {
          disease_burden: { qualitative_summary: "Serious disease." },
        },
      },
      customDeps as unknown as ReturnType<typeof makeDeps>,
    );
    expect(mockUnmetNeed).toHaveBeenCalledTimes(1);
    expect(r.content).toMatch(/unmet_need|evidence.unmet_need|Phase 3\.5/i);
  });

  it("Phase 3.5 skipped when no unmet_need_inputs", async () => {
    const mockUnmetNeed = jest.fn();
    const customDeps = {
      ...makeDeps(),
      evidenceUnmetNeed: mockUnmetNeed,
    };
    await run(
      { drug: "X", indication: "Y", hta_body: "gvd" },
      customDeps as unknown as ReturnType<typeof makeDeps>,
    );
    expect(mockUnmetNeed).not.toHaveBeenCalled();
  });

  it("Phase 3.5 failure does not abort pipeline", async () => {
    const mockUnmetNeed = jest.fn().mockRejectedValue(new Error("unmet fail"));
    const customDeps = {
      ...makeDeps(),
      evidenceUnmetNeed: mockUnmetNeed,
    };
    const r = await run(
      {
        drug: "X",
        indication: "Y",
        hta_body: "gvd",
        unmet_need_inputs: {
          disease_burden: { qualitative_summary: "Serious." },
        },
      },
      customDeps as unknown as ReturnType<typeof makeDeps>,
    );
    // pipeline completes (has Phase 5 output)
    expect(r.content).toMatch(/Phase 5|hta_dossier/i);
  });

  it("Phase 3.5 skipped for non-GVD hta_body even when unmet_need_inputs present", async () => {
    const mockUnmetNeed = jest.fn();
    const customDeps = {
      ...makeDeps(),
      evidenceUnmetNeed: mockUnmetNeed,
    };
    await run(
      {
        drug: "X",
        indication: "Y",
        hta_body: "nice",
        unmet_need_inputs: {
          disease_burden: { qualitative_summary: "Serious." },
        },
      },
      customDeps as unknown as ReturnType<typeof makeDeps>,
    );
    expect(mockUnmetNeed).not.toHaveBeenCalled();
  });

  it("Phase 3.5 summary row appears in pipeline table when it ran", async () => {
    const mockUnmetNeed = jest.fn().mockResolvedValue({
      content: JSON.stringify({ unmet_need_summary: "High unmet need." }),
    });
    const customDeps = {
      ...makeDeps(),
      evidenceUnmetNeed: mockUnmetNeed,
    };
    const r = await run(
      {
        drug: "X",
        indication: "Y",
        hta_body: "gvd",
        unmet_need_inputs: {
          disease_burden: { qualitative_summary: "Serious." },
        },
      },
      customDeps as unknown as ReturnType<typeof makeDeps>,
    );
    expect(r.content).toMatch(
      /3\.5.*evidence\.unmet_need|evidence_unmet_need/i,
    );
  });

  it("workflow_summary includes evidence_unmet_need timing when Phase 3.5 ran", async () => {
    const mockUnmetNeed = jest.fn().mockResolvedValue({
      content: JSON.stringify({ unmet_need_summary: "High unmet need." }),
    });
    const customDeps = {
      ...makeDeps(),
      evidenceUnmetNeed: mockUnmetNeed,
    };
    const r = await run(
      {
        drug: "X",
        indication: "Y",
        hta_body: "gvd",
        unmet_need_inputs: {
          disease_burden: { qualitative_summary: "Serious." },
        },
      },
      customDeps as unknown as ReturnType<typeof makeDeps>,
    );
    expect(
      r.workflow_summary?.phase_timings_ms?.evidence_unmet_need,
    ).toBeDefined();
    expect(
      r.workflow_summary?.phase_timings_ms?.evidence_unmet_need,
    ).toBeGreaterThanOrEqual(0);
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

// ── Design log #26: Phase 3.6 regulatory_landscape tests ─────────────────

// Mock autoCheckRegulatory at the module level for htaWorkflow Phase 3.6 tests.
// htaWorkflow imports autoCheckRegulatory lazily inside runHtaWorkflow, so we
// mock the module here.
const mockAutoCheckRegulatoryHta = jest.fn();

jest.mock("../../src/providers/regulatory/autoCheck.js", () => ({
  autoCheckRegulatory: mockAutoCheckRegulatoryHta,
}));

function makeApprovedAutoCheckResult(drug: string, region: string) {
  return {
    drug,
    region,
    result: {
      schema_version: "1.0",
      drug,
      drug_normalised_inn: drug.toLowerCase(),
      drug_brand_names: [],
      region,
      current_status: "approved",
      approved_indications: [
        {
          indication_text_verbatim: `${drug} is approved for the preventive treatment of migraine.`,
          population: "adults",
          population_parsed: null,
          approval_date: "2020-01",
          label_revision: null,
          region_specific: false,
        },
      ],
      black_box_warnings: [],
      rems_required: false,
      contraindications: [],
      recent_label_changes: {
        count_12_months: 0,
        last_revision_date: null,
        last_revision_summary: null,
      },
      source_urls: [
        {
          source: "OpenFDA",
          url: "https://api.fda.gov/drug/label.json",
          fetched_at: "2026-05-10T00:00:00Z",
        },
      ],
      data_fetched_at: "2026-05-10T00:00:00Z",
      data_age_hours: 0,
      cache_hit: false,
    },
  };
}

// Deps factory that includes regulatory mock + comparator in pico
function makeDepsWithRegulatory(opts: Parameters<typeof makeDeps>[0] = {}) {
  return {
    ...makeDeps(opts),
    // evidenceUnmetNeed returns a result with unmet_need_summary
    evidenceUnmetNeed: jest.fn().mockResolvedValue({
      unmet_need_summary: "High unmet need.",
      regulatory_context: [],
    }),
  };
}

describe("hta_workflow — design log #26: Phase 3.6 regulatory_landscape", () => {
  beforeEach(() => {
    mockAutoCheckRegulatoryHta.mockReset();
    mockAutoCheckRegulatoryHta.mockResolvedValue([]);
  });

  // ── Test #26-HTA-1: Phase 3.6 fires by default when comparator provided ──

  it("#26-HTA-1: Phase 3.6 fires by default and regulatory.status_check appears in pipeline table", async () => {
    mockAutoCheckRegulatoryHta.mockResolvedValueOnce([
      makeApprovedAutoCheckResult("erenumab", "us"),
    ]);

    const r = await run(
      {
        drug: "drugX",
        indication: "migraine",
        pico: { comparator: "erenumab" },
        jurisdictions: [],
      },
      makeDepsWithRegulatory(),
    );

    expect(r.content).toMatch(/3\.6|regulatory.*status|regulatory_landscape/i);
  });

  // ── Test #26-HTA-2: Phase 3.6 skipped when auto_check_regulatory=false ───

  it("#26-HTA-2: Phase 3.6 skipped when auto_check_regulatory=false", async () => {
    const r = await run(
      {
        drug: "drugX",
        indication: "migraine",
        pico: { comparator: "erenumab" },
        auto_check_regulatory: false,
      },
      makeDepsWithRegulatory(),
    );

    // autoCheckRegulatory must NOT be called from the workflow
    expect(mockAutoCheckRegulatoryHta).not.toHaveBeenCalled();
    // Phase 3.6 row should NOT appear
    expect(r.content).not.toMatch(/\| 3\.6 \|/);
  });

  // ── Test #26-HTA-3: Phase 3.6 failure does not abort pipeline ────────────

  it("#26-HTA-3: Phase 3.6 failure does not abort pipeline (Phase 5 still produces dossier)", async () => {
    // Make autoCheckRegulatory throw
    mockAutoCheckRegulatoryHta.mockRejectedValueOnce(
      new Error("rate limit exceeded"),
    );

    const r = await run(
      {
        drug: "drugX",
        indication: "migraine",
        pico: { comparator: "erenumab" },
      },
      makeDepsWithRegulatory(),
    );

    // Pipeline still completes with dossier output
    expect(r.content).toMatch(/HTA Submission Workflow/);
    expect(r.content).toMatch(/hta_dossier|Phase 5/i);
    // workflow_summary still defined
    expect(r.workflow_summary?.total_ms).toBeGreaterThanOrEqual(0);
  });

  // ── Test #26-HTA-4: phase_timings_ms.regulatory_status_check defined ─────

  it("#26-HTA-4: phase_timings_ms.regulatory_status_check is defined and non-negative when Phase 3.6 runs", async () => {
    mockAutoCheckRegulatoryHta.mockResolvedValueOnce([
      makeApprovedAutoCheckResult("erenumab", "us"),
    ]);

    const r = await run(
      {
        drug: "drugX",
        indication: "migraine",
        pico: { comparator: "erenumab" },
      },
      makeDepsWithRegulatory(),
    );

    expect(
      r.workflow_summary?.phase_timings_ms?.regulatory_status_check,
    ).toBeDefined();
    expect(
      r.workflow_summary?.phase_timings_ms?.regulatory_status_check,
    ).toBeGreaterThanOrEqual(0);
  });

  // ── Test #26-HTA-5: no comparators → Phase 3.6 is a fast no-op ───────────

  it("#26-HTA-5: no pico.comparator and no unmet_need_inputs → Phase 3.6 is no-op (no regulatory calls)", async () => {
    const r = await run(
      {
        drug: "drugX",
        indication: "migraine",
        // no pico.comparator, no unmet_need_inputs
      },
      makeDepsWithRegulatory(),
    );

    // autoCheckRegulatory should not be called (nothing to check)
    expect(mockAutoCheckRegulatoryHta).not.toHaveBeenCalled();
    // Pipeline still completes
    expect(r.content).toMatch(/HTA Submission Workflow/);
  });

  // ── Test #26-HTA-6: auto_check_regulatory schema default is true ──────────

  it("#26-HTA-6: htaWorkflowToolSchema has auto_check_regulatory with default true", () => {
    const schema = htaWorkflowSchemaForTests.inputSchema as {
      properties: Record<string, { type: string; default?: unknown }>;
    };
    expect(schema.properties["auto_check_regulatory"]).toBeDefined();
    expect(schema.properties["auto_check_regulatory"].type).toBe("boolean");
    expect(schema.properties["auto_check_regulatory"].default).toBe(true);
  });
});

// ---- Codex review (2026-05-07) -----------------------------------------

describe("hta_workflow — Codex P2: utility partial-input must not break CE", () => {
  // Workflow accepted qaly_on_treatment OR qaly_comparator independently and
  // built {utility_inputs} if either was set, but the CE model schema requires
  // BOTH fields once utility_inputs exists. Result: silent fallthrough into CE
  // workflow fallback. Fix: require both before constructing utility_inputs.

  it("does NOT pass utility_inputs when only qaly_on_treatment is supplied", async () => {
    // The workflow sets `utility_inputs: undefined` when one half is missing —
    // the key may exist on the object but the VALUE must be undefined so the
    // CE schema (which requires both qaly fields when utility_inputs is set)
    // doesn't reject. Test the value, not key presence.
    let receivedHasUtility = false;
    const deps = {
      ...makeDeps(),
      costEffectivenessModel: async (input: unknown) => {
        const v =
          typeof input === "object" && input !== null
            ? (input as { utility_inputs?: unknown }).utility_inputs
            : undefined;
        receivedHasUtility = v !== undefined;
        return {
          content: JSON.stringify({
            base_case: { icer: 1000, delta_cost: 100, delta_qaly: 0.1 },
          }),
        };
      },
    };
    const r = await run(
      {
        drug: "drugX",
        indication: "Y",
        ce_inputs: { qaly_on_treatment: 0.78 }, // only one of two
      },
      deps as ReturnType<typeof makeDeps>,
    );
    expect(receivedHasUtility).toBe(false);
    expect(r.content).toMatch(/cost_effectiveness_model/);
  });

  it("DOES pass utility_inputs when BOTH qaly fields are supplied", async () => {
    let receivedUtility: unknown = undefined;
    const deps = {
      ...makeDeps(),
      costEffectivenessModel: async (input: unknown) => {
        if (typeof input === "object" && input !== null) {
          receivedUtility = (input as { utility_inputs?: unknown })
            .utility_inputs;
        }
        return {
          content: JSON.stringify({
            base_case: { icer: 1000, delta_cost: 100, delta_qaly: 0.1 },
          }),
        };
      },
    };
    await run(
      {
        drug: "drugX",
        indication: "Y",
        ce_inputs: { qaly_on_treatment: 0.78, qaly_comparator: 0.71 },
      },
      deps as ReturnType<typeof makeDeps>,
    );
    expect(receivedUtility).toEqual({
      qaly_on_treatment: 0.78,
      qaly_comparator: 0.71,
    });
  });
});

describe("hta_workflow — confounder identification (Phase 2.5, design log #43)", () => {
  it("runs confounder_identification when the flag is set and renders an annex", async () => {
    let calledWith: Record<string, unknown> | undefined;
    const deps = {
      ...makeDeps(),
      confounderIdentification: async (args: unknown) => {
        calledWith = args as Record<string, unknown>;
        return {
          content: {
            markdown_report:
              "# Confounder Identification (Pufulete Step 1)\n- Baseline EDSS",
            status_label: "draft_for_human_consolidation",
          },
        };
      },
    };
    const result = await runHtaWorkflow(
      {
        drug: "Drug X",
        indication: "Indication Y",
        include_confounder_identification: true,
        pico: { comparator: "placebo" },
      },
      deps,
    );
    expect(calledWith).toBeDefined();
    expect(calledWith!.mode).toBe("closed_corpus");
    expect(Array.isArray(calledWith!.corpus_papers)).toBe(true);
    const content = result.content as string;
    expect(content).toContain("Confounder Identification (Annex");
    expect(content).toContain("Baseline EDSS");
  });

  it("does NOT run confounder_identification by default", async () => {
    let called = false;
    const deps = {
      ...makeDeps(),
      confounderIdentification: async () => {
        called = true;
        return { content: { markdown_report: "x" } };
      },
    };
    const result = await runHtaWorkflow(
      { drug: "Drug X", indication: "Indication Y" },
      deps,
    );
    expect(called).toBe(false);
    expect(result.content as string).not.toContain(
      "Confounder Identification (Annex",
    );
  });
});

describe("hta_workflow — Codex P3: unmet_need_inputs visible in MCP tool schema", () => {
  it("htaWorkflowToolSchema.inputSchema.properties.unmet_need_inputs is exported", async () => {
    const mod = await import("../../src/tools/htaWorkflow.js");
    const props = (
      mod.htaWorkflowToolSchema.inputSchema as {
        properties: Record<string, unknown>;
      }
    ).properties;
    expect(props.unmet_need_inputs).toBeDefined();
    const unmet = props.unmet_need_inputs as {
      type: string;
      description?: string;
      properties: Record<string, unknown>;
    };
    expect(unmet.type).toBe("object");
    expect(unmet.properties.disease_burden).toBeDefined();
    expect(unmet.properties.treatment_landscape).toBeDefined();
    expect(unmet.description).toMatch(/Phase 3\.5|evidence\.unmet_need/i);
  });
});
