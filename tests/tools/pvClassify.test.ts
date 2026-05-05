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
    await expect(handlePvClassify({})).rejects.toThrow(
      /required|drug|indication/i,
    );
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
      {
        regulatory_context: "post_authorisation",
        imposed_by_authority: true,
        primary_objective: "safety",
      },
      {
        regulatory_context: "post_authorisation",
        imposed_by_authority: false,
        primary_objective: "safety",
      },
      {
        regulatory_context: "post_authorisation",
        imposed_by_authority: false,
        primary_objective: "effectiveness",
      },
      {
        regulatory_context: "post_authorisation",
        imposed_by_authority: false,
        primary_objective: "drug_utilization",
      },
      {
        regulatory_context: "post_authorisation",
        imposed_by_authority: false,
        primary_objective: "natural_history",
      },
      {
        regulatory_context: "pre_authorisation",
        imposed_by_authority: false,
        primary_objective: "safety",
      },
      {
        regulatory_context: "rmp_commitment",
        imposed_by_authority: false,
        primary_objective: "safety",
      },
    ];
    for (const inp of inputs) {
      const r = await classify({
        drug: "x",
        indication: "y",
        study_design: "rct",
        ...inp,
      });
      expect(r.pv_classification.gvp_module).toMatch(
        /^(V|VI|VIII|VIII_Addendum_I)$/,
      );
    }
  });

  it("includes an ENCePP study-category label for PASS/registry categories (not a fabricated protocol ID)", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: true,
    });
    expect(r.pv_classification.encepp_study_category).toBeDefined();
    // Must be a category label (mentions PASS / Module / ENCePP context),
    // NOT a fabricated protocol-ID pattern like "ENCePP-PASS-001".
    expect(r.pv_classification.encepp_study_category).toMatch(
      /PASS|Module|ENCePP/,
    );
    expect(r.pv_classification.encepp_study_category).not.toMatch(
      /ENCePP-PASS-\d{3}/,
    );
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

// ── Code-review fixes (HIGH / MEDIUM from 2026-05-05 review) ─────────────

describe("pv_classify — conditional_approval without imposed flag (HIGH)", () => {
  it("emits a CMA Specific-Obligations warning when conditional_approval + imposed_by_authority=false", async () => {
    // EMA conditional MA carries Specific Obligations (SOBs) under Article 14-a.
    // Even without imposed_by_authority=true, the user should be prompted to
    // confirm SOB status — silent fall-through to PASS_voluntary is misleading.
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "conditional_approval",
      imposed_by_authority: false,
    });
    expect(String(r.content)).toMatch(
      /conditional|specific obligation|CMA|Article 14|SOB/i,
    );
  });

  it("accelerated_approval also flags possible imposition", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "accelerated_approval",
      imposed_by_authority: false,
    });
    expect(String(r.content)).toMatch(
      /accelerated|conditional|specific obligation|imposition|imposed/i,
    );
  });
});

describe("pv_classify — ENCePP field is honest (HIGH)", () => {
  it("does NOT include fabricated 'ENCePP-PASS-001' style IDs that imply a real protocol reference", async () => {
    // Per code review: those IDs are not registered in any ENCePP catalogue.
    // The output must use category labels, not fabricated protocol identifiers.
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: true,
    });
    expect(String(r.content)).not.toMatch(
      /ENCePP-PASS-\d{3}|ENCePP-PAES-\d{3}|ENCePP-RMP-\d{3}|ENCePP-DUS-\d{3}|ENCePP-REG-\d{3}|ENCePP-PREG-\d{3}/,
    );
  });

  it("output references ENCePP Code of Conduct / EUPAS register, not made-up template IDs", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "single_arm",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: true,
    });
    expect(String(r.content)).toMatch(
      /ENCePP Code of Conduct|EUPAS|study category|PASS|Module VIII/,
    );
  });
});

describe("pv_classify — ICH E2E mapping honesty (HIGH)", () => {
  it("rationale text for pre_authorisation acknowledges ICH E2E is a separate ICH guideline (not a GVP module)", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "pre_authorisation",
    });
    expect(r.pv_classification.rationale).toMatch(
      /ICH E2E.*(guideline|standalone|not.*GVP module|informs the RMP)/i,
    );
  });
});

describe("pv_classify — rmp_commitment precedence (MEDIUM)", () => {
  it("rmp_commitment + imposed_by_authority=true yields PASS_imposed primary, RMP_Annex_4_study alternative", async () => {
    // Per code review: an imposed PASS that's also tracked in RMP Annex 4
    // is primarily a PASS_imposed under Article 107n. Inverting precedence
    // would route the GVP Module V metadata, not Module VIII PRAC review.
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "prospective_cohort",
      primary_objective: "safety",
      regulatory_context: "rmp_commitment",
      imposed_by_authority: true,
    });
    expect(r.pv_classification.primary_category).toBe("PASS_imposed");
    expect(r.pv_classification.alternatives).toContain("RMP_Annex_4_study");
  });

  it("rmp_commitment + imposed_by_authority=false still yields RMP_Annex_4_study", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "prospective_cohort",
      primary_objective: "safety",
      regulatory_context: "rmp_commitment",
      imposed_by_authority: false,
    });
    expect(r.pv_classification.primary_category).toBe("RMP_Annex_4_study");
  });
});

describe("pv_classify — spontaneous_reports + imposed conflict (MEDIUM)", () => {
  it("emits a warning when study_design=spontaneous_reports AND imposed_by_authority=true (contradictory)", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "spontaneous_reports",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      imposed_by_authority: true,
    });
    // Verdict stays as spontaneous_reporting_only, but the audit / output
    // flags that imposed_by_authority is meaningless for spontaneous reporting.
    expect(String(r.content)).toMatch(
      /spontaneous.*imposed|imposed.*spontaneous|contradictory|inherent obligation/i,
    );
  });
});

describe("pv_classify — CMS IRA claim accuracy (MEDIUM)", () => {
  it("does NOT claim IRA contains a specific PV-cost-data carve-out (no statutory basis for that claim)", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      jurisdictions: ["us"],
    });
    const t = String(r.content);
    // Older copy: "CMS IRA excludes pharmacovigilance cost data from
    // Medicare drug-price negotiation calculations." — not in the statute.
    expect(t).not.toMatch(/IRA excludes pharmacovigilance cost data/i);
    expect(t).not.toMatch(
      /excludes pharmacovigilance cost data from Medicare/i,
    );
  });

  it("mentions IRA-PV separation in softened language (track separately, not statutory exclusion)", async () => {
    const r = await classify({
      drug: "x",
      indication: "y",
      study_design: "rct",
      primary_objective: "safety",
      regulatory_context: "post_authorisation",
      jurisdictions: ["us"],
    });
    const t = String(r.content);
    expect(t).toMatch(
      /track.*separately|regulatory budget|not.*input.*Maximum Fair Price|separate from the HEOR/i,
    );
  });
});
