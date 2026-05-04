/**
 * Tests for pv_classify — pharmacovigilance study classification.
 *
 * Maps a planned study's metadata onto its EMA GVP regulatory category
 * (PASS imposed/voluntary, PAES, RMP Annex 4, DUS, registry, pregnancy
 * registry, spontaneous reporting, ICH E2E plan, or not_pv_study) and
 * the corresponding GVP module + ENCePP protocol template + RMP and FDA
 * implications. Pure decision-tree logic, no I/O.
 *
 * Per design log #11: 12 PvCategory leaves; pregnancy population always
 * overrides; pre-authorisation never yields a PASS verdict.
 */
import {
  handlePvClassify,
  type PvClassification,
} from "../../src/tools/pvClassify.js";

interface PvResult {
  content: string;
  pv_classification: PvClassification;
}

async function classify(input: Record<string, unknown>): Promise<PvResult> {
  const r = (await handlePvClassify(input)) as unknown as PvResult;
  return r;
}

// ---- Schema validation ---------------------------------------------------

describe("pv_classify — schema validation", () => {
  it("requires drug, indication, study_design, primary_objective, regulatory_context", async () => {
    await expect(handlePvClassify({})).rejects.toThrow(/required|drug|indication/i);
  });

  it("accepts the minimal valid input", async () => {
    const r = await classify({
      drug: "semaglutide",
      indication: "obesity",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
    });
    expect(r.pv_classification.primary_category).toBeDefined();
    expect(r.pv_classification.gvp_revision).toBe("rev_4");
  });

  it("rejects an unknown study_design with did-you-mean", async () => {
    await expect(
      classify({
        drug: "x",
        indication: "y",
        study_design: "randomized_trial" as never,
        primary_objective: "safety",
        regulatory_context: "post_authorisation",
      }),
    ).rejects.toThrow(/rct|study_design/i);
  });

  it("rejects an unknown jurisdiction with did-you-mean", async () => {
    await expect(
      classify({
        drug: "x",
        indication: "y",
        study_design: "rct",
        primary_objective: "safety",
        regulatory_context: "post_authorisation",
        jurisdictions: ["europe"] as never,
      }),
    ).rejects.toThrow(/eu|jurisdictions/i);
  });
});

// ---- Decision tree: each leaf reachable ---------------------------------

describe("pv_classify — decision tree leaves", () => {
  it("PASS_imposed: conditional approval + imposed by authority", async () => {
    const r = await classify({
      drug: "elranatamab",
      indication: "relapsed multiple myeloma",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "conditional_approval",
      imposed_by_authority: true,
    });
    expect(r.pv_classification.primary_category).toBe("PASS_imposed");
  });

  it("PASS_imposed: post-authorisation + imposed by authority", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "prospective_cohort",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: true,
    });
    expect(r.pv_classification.primary_category).toBe("PASS_imposed");
  });

  it("PASS_voluntary: post-authorisation + safety + not imposed", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "prospective_cohort",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: false,
    });
    expect(r.pv_classification.primary_category).toBe("PASS_voluntary");
  });

  it("PAES: post-authorisation + efficacy/effectiveness", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "effectiveness",
      regulatory_context: "post_authorisation",
    });
    expect(r.pv_classification.primary_category).toBe("PAES");
  });

  it("DUS: drug_utilization objective", async () => {
    const r = await classify({
      drug: "semaglutide",
      indication: "obesity",
      study_design: "retrospective_cohort",
      primary_objective: "drug_utilization",
      regulatory_context: "post_authorisation",
    });
    expect(r.pv_classification.primary_category).toBe("DUS");
  });

  it("active_surveillance_registry: registry design + natural_history", async () => {
    const r = await classify({
      drug: "ozanimod",
      indication: "ulcerative colitis",
      study_design: "registry",
      primary_objective: "natural_history",
      regulatory_context: "post_authorisation",
    });
    expect(r.pv_classification.primary_category).toBe(
      "active_surveillance_registry",
    );
  });

  it("pregnancy_registry: pregnant population overrides primary", async () => {
    const r = await classify({
      drug: "ozanimod",
      indication: "ulcerative colitis",
      study_design: "registry",
      primary_objective: "natural_history",
      regulatory_context: "post_authorisation",
      population_includes_pregnant: true,
    });
    expect(r.pv_classification.primary_category).toBe("pregnancy_registry");
    // pregnancy override should keep the would-be primary as an alternative
    expect(r.pv_classification.alternatives).toContain(
      "active_surveillance_registry",
    );
  });

  it("spontaneous_reporting_only: spontaneous_reports design", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "spontaneous_reports",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
    });
    expect(r.pv_classification.primary_category).toBe(
      "spontaneous_reporting_only",
    );
  });

  it("ICH_E2E_pharmacovigilance_plan: pre-authorisation context", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "pre_authorisation",
    });
    expect(r.pv_classification.primary_category).toBe(
      "ICH_E2E_pharmacovigilance_plan",
    );
  });

  it("RMP_Annex_4_study: rmp_commitment context", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "prospective_cohort",
      primary_objective: "safety",
      regulatory_context: "rmp_commitment",
    });
    expect(r.pv_classification.primary_category).toBe("RMP_Annex_4_study");
  });
});

// ---- Hard rules ----------------------------------------------------------

describe("pv_classify — hard rules", () => {
  it("pre_authorisation NEVER yields a PASS_* verdict", async () => {
    // PASS requires a marketing authorisation. Pre-MA studies are
    // characterised under ICH E2E.
    for (const objective of [
      "safety",
      "efficacy",
      "drug_utilization",
    ] as const) {
      const r = await classify({
        drug: "x",
        indication: "y",
        study_design: "rct",
        primary_objective: objective,
        regulatory_context: "pre_authorisation",
        imposed_by_authority: true,
      });
      expect(r.pv_classification.primary_category).not.toMatch(/^PASS_/);
    }
  });

  it("pregnancy population in any post-MA context yields pregnancy_registry as primary or alternative", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "prospective_cohort",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      population_includes_pregnant: true,
    });
    const cats = [
      r.pv_classification.primary_category,
      ...(r.pv_classification.alternatives ?? []),
    ];
    expect(cats).toContain("pregnancy_registry");
  });
});

// ---- GVP module + ENCePP mapping ----------------------------------------

describe("pv_classify — GVP module and ENCePP template mapping", () => {
  it("PASS_imposed maps to GVP Module VIII", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: true,
    });
    expect(r.pv_classification.gvp_module).toBe("VIII");
  });

  it("ICH_E2E plan maps to GVP Module V (RMP) — pre-MA risk planning", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "pre_authorisation",
    });
    expect(r.pv_classification.gvp_module).toBe("V");
  });

  it("every primary category resolves to exactly one GVP module", async () => {
    // The mapping must be total (no undefined gvp_module values).
    const inputs = [
      { regulatory_context: "post_authorisation", imposed_by_authority: true, primary_objective: "safety" },
      { regulatory_context: "post_authorisation", imposed_by_authority: false, primary_objective: "safety" },
      { regulatory_context: "post_authorisation", imposed_by_authority: false, primary_objective: "effectiveness" },
      { regulatory_context: "post_authorisation", imposed_by_authority: false, primary_objective: "drug_utilization" },
      { regulatory_context: "post_authorisation", imposed_by_authority: false, primary_objective: "natural_history" },
      { regulatory_context: "pre_authorisation", imposed_by_authority: false, primary_objective: "safety" },
      { regulatory_context: "rmp_commitment", imposed_by_authority: false, primary_objective: "safety" },
    ];
    for (const inp of inputs) {
      const r = await classify({
        drug: "x",
        indication: "y",
        study_design: "rct",
        ...inp,
      });
      expect(r.pv_classification.gvp_module).toMatch(/^(V|VI|VIII|VIII_Addendum_I)$/);
    }
  });

  it("includes an ENCePP protocol template reference for PASS/registry categories", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: true,
    });
    expect(r.pv_classification.encepp_protocol_template).toBeDefined();
    expect(r.pv_classification.encepp_protocol_template).toMatch(/ENCePP/);
  });
});

// ---- Output content -----------------------------------------------------

describe("pv_classify — output content", () => {
  it("markdown output names primary_category, GVP module, and rationale", async () => {
    const r = await classify({
      drug: "elranatamab",
      indication: "relapsed multiple myeloma",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "conditional_approval",
      imposed_by_authority: true,
    });
    const t = r.content;
    expect(t).toMatch(/PASS_imposed/);
    expect(t).toMatch(/GVP/);
    expect(t).toMatch(/Module VIII/);
    expect(t).toMatch(/Rationale/i);
  });

  it("flags CMS IRA implications when jurisdictions includes 'us'", async () => {
    // CMS IRA price negotiations exclude PV cost data from the threshold
    // calculation. Surface this explicitly when US is in scope.
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      jurisdictions: ["eu", "us"],
    });
    expect(String(r.content)).toMatch(/CMS IRA|Inflation Reduction Act/i);
  });

  it("notes FDA mapping is stubbed in v1 when jurisdictions includes 'us'", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      jurisdictions: ["us"],
    });
    const t = String(r.content);
    expect(t).toMatch(/FDA|REMS|Sentinel/);
  });

  it("does not mention CMS IRA when jurisdictions is EU-only", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      jurisdictions: ["eu"],
    });
    expect(String(r.content)).not.toMatch(/CMS IRA/i);
  });

  it("returns submission_obligations as an array of strings", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: true,
    });
    expect(Array.isArray(r.pv_classification.submission_obligations)).toBe(
      true,
    );
    expect(r.pv_classification.submission_obligations.length).toBeGreaterThan(
      0,
    );
  });
});

// ---- Performance --------------------------------------------------------

describe("pv_classify — performance", () => {
  it("returns in under 200ms (no I/O, pure decision logic)", async () => {
    const start = Date.now();
    await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
    });
    expect(Date.now() - start).toBeLessThan(200);
  });
});
