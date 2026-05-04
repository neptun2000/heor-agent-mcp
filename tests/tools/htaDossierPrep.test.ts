import { handleHtaDossierPrep } from "../../src/tools/htaDossierPrep.js";

const rctStudy = {
  id: "pmid_1",
  source: "pubmed",
  title: "Semaglutide vs placebo: a randomized double-blind trial",
  authors: ["Smith J"],
  date: "2024-01-15",
  study_type: "RCT",
  abstract:
    "We randomized 1000 adults to semaglutide or placebo. Allocation concealment was maintained via central randomization. Double-blind with blinded assessment of outcomes. Complete follow-up with no missing data. Intention-to-treat analysis. Pre-registered at ClinicalTrials.gov.",
  url: "https://pubmed.ncbi.nlm.nih.gov/1",
};

const goodRobResults = {
  summary: {
    rob_judgment: "Low",
    downgrade: false,
    rationale: "Well-conducted RCT with low risk across all domains",
  },
  overall_certainty_start: "High" as const,
};

const highRobResults = {
  summary: {
    rob_judgment: "High",
    downgrade: true,
    rationale: "Open-label, no allocation concealment",
  },
  overall_certainty_start: "High" as const,
};

const baseParams = {
  hta_body: "nice" as const,
  submission_type: "sta" as const,
  drug_name: "semaglutide",
  indication: "type 2 diabetes",
};

describe("handleHtaDossierPrep — rob_results integration", () => {
  it("accepts rob_results without throwing", async () => {
    await expect(
      handleHtaDossierPrep({
        ...baseParams,
        evidence_summary: [rctStudy],
        rob_results: goodRobResults,
      }),
    ).resolves.not.toThrow();
  });

  it("GRADE table uses structured rob_judgment when rob_results provided (Low)", async () => {
    const result = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      rob_results: goodRobResults,
    });
    expect(result.content).toContain("structured Risk of Bias assessment");
    expect(result.content).not.toContain("heuristic");
  });

  it("GRADE table uses heuristic note when rob_results omitted", async () => {
    const result = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
    });
    expect(result.content).toContain("heuristic");
  });

  it("high rob_results downgrades certainty vs low rob_results", async () => {
    const lowResult = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      rob_results: goodRobResults,
    });
    const highResult = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      rob_results: highRobResults,
    });
    // High RoB should appear in the table; Low RoB should show Low
    expect(highResult.content).toContain("High");
    // Low RoB with a good RCT base → High certainty is achievable
    expect(typeof lowResult.content).toBe("string");
  });

  it("works without evidence_summary (no GRADE table generated)", async () => {
    const result = await handleHtaDossierPrep({
      ...baseParams,
      rob_results: goodRobResults,
    });
    expect(result.content).not.toContain("GRADE Evidence Quality");
  });

  it("returns an audit record", async () => {
    const result = await handleHtaDossierPrep({ ...baseParams });
    expect(result.audit).toBeDefined();
    expect(result.audit.tool).toBe("hta.dossier");
  });

  // Validation surfaced silent no-op: GRADE table iterates over default
  // outcomes; if upgrading_per_outcome / heterogeneity_per_outcome use a
  // key not in the default list (e.g., "mortality"), the flag was silently
  // dropped. Auto-merge those keys into the iterated set.
  describe("auto-merge upgrading/heterogeneity keys into iterated outcomes", () => {
    const cohortStudy = {
      title: "Cohort 1 of mortality",
      abstract: "observational",
      study_type: "observational cohort",
      url: "u1",
      source: "pubmed" as const,
    };

    it("includes a custom outcome 'mortality' in the GRADE table when upgrading_per_outcome.mortality is set", async () => {
      const result = await handleHtaDossierPrep({
        ...baseParams,
        evidence_summary: [cohortStudy, cohortStudy, cohortStudy],
        upgrading_per_outcome: {
          mortality: { large_effect: "very_large", dose_response: true },
        },
      });
      const txt =
        typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content);
      expect(txt).toMatch(/\| mortality \|/);
      expect(txt).toMatch(/Upgraded \+2|very large effect/);
    });

    it("includes a custom outcome from heterogeneity_per_outcome", async () => {
      const result = await handleHtaDossierPrep({
        ...baseParams,
        evidence_summary: [
          { ...cohortStudy, study_type: "RCT" },
          { ...cohortStudy, study_type: "RCT" },
          { ...cohortStudy, study_type: "RCT" },
        ],
        heterogeneity_per_outcome: {
          "MACE composite": { i_squared_pct: 80, n_studies: 3 },
        },
      });
      const txt = String(result.content);
      expect(txt).toMatch(/\| MACE composite \|/);
      expect(txt).toMatch(/I²=80%/);
    });

    it("does NOT duplicate when an outcome is in BOTH upgrading_per_outcome and explicit outcomes (via picos)", async () => {
      const result = await handleHtaDossierPrep({
        ...baseParams,
        evidence_summary: [cohortStudy, cohortStudy, cohortStudy],
        upgrading_per_outcome: {
          "overall survival": { large_effect: "very_large" },
        },
      });
      const txt = String(result.content);
      const matches = txt.match(/\| overall survival \|/g) ?? [];
      // Should appear exactly once in the GRADE table, not twice
      expect(matches.length).toBe(1);
    });

    it("merges keys from BOTH upgrading and heterogeneity into a single iteration", async () => {
      const result = await handleHtaDossierPrep({
        ...baseParams,
        evidence_summary: [
          { ...cohortStudy, study_type: "RCT" },
          { ...cohortStudy, study_type: "RCT" },
        ],
        heterogeneity_per_outcome: {
          "biomarker A": { i_squared_pct: 30, n_studies: 2 },
        },
        upgrading_per_outcome: {
          "biomarker B": { large_effect: "large" },
        },
      });
      const txt = String(result.content);
      expect(txt).toMatch(/\| biomarker A \|/);
      expect(txt).toMatch(/\| biomarker B \|/);
    });
  });
});

// ---- pv_classification integration (design log #11 Phase 2) ------------

describe("handleHtaDossierPrep — pv_classification integration", () => {
  const passImposedClassification = {
    primary_category: "PASS_imposed",
    alternatives: ["RMP_Annex_4_study"],
    gvp_module: "VIII",
    gvp_revision: "rev_4",
    encepp_protocol_template: "ENCePP-PASS-001",
    rmp_implications: [
      "Update RMP Part III (PV Plan) to list this study as an imposed PASS.",
      "Annex 4 of the RMP must reference the protocol and timelines.",
    ],
    fda_analogue: "FDA Postmarketing Required Studies (PMR)",
    submission_obligations: [
      "Protocol submission to PRAC for review prior to study start.",
      "Annual safety update reports during conduct.",
    ],
    rationale:
      "Authority-imposed obligation in a post-authorisation context (Article 107n).",
  };

  it("emits a Pharmacovigilance Plan section when pv_classification is provided", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      pv_classification: passImposedClassification,
    });
    const txt = r.content as string;
    expect(txt).toMatch(/##\s+Pharmacovigilance Plan/i);
    expect(txt).toContain("PASS_imposed");
    expect(txt).toContain("Module VIII");
    expect(txt).toContain("ENCePP-PASS-001");
  });

  it("includes submission_obligations and rmp_implications in the PV section", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      pv_classification: passImposedClassification,
    });
    const txt = r.content as string;
    expect(txt).toContain("PRAC");
    expect(txt).toContain("Annex 4");
  });

  it("emits a one-line fallback when pv_classification is omitted", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
    });
    const txt = r.content as string;
    // The dossier should not contain a fully-populated PV section, but it
    // should reference the missing PV plan so reviewers see the gap.
    expect(txt).toMatch(/PV plan not provided|Pharmacovigilance Plan: not/i);
  });

  it("rejects a malformed pv_classification with did-you-mean", async () => {
    await expect(
      handleHtaDossierPrep({
        ...baseParams,
        evidence_summary: [rctStudy],
        pv_classification: {
          primary_category: "PASS_imposed_typo",
          gvp_module: "VIII",
        },
      } as never),
    ).rejects.toThrow();
  });
});

// ---- NICE PMG36 March 2026 update: severity modifier + health inequalities

describe("handleHtaDossierPrep — NICE severity modifier (PMG36 2022/2026)", () => {
  it("computes severity modifier weight from QALY shortfall (1.0×, 1.2×, 1.7×)", async () => {
    // NICE severity modifier (replaces the end-of-life modifier):
    //   absolute QALY shortfall ≥12 OR proportional ≥0.85 → 1.7×
    //   absolute 12-18 OR proportional 0.85-0.95 etc per PMG36 Table 4.4
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      severity_modifier: {
        absolute_qaly_shortfall: 18,
        proportional_qaly_shortfall: 0.92,
      },
    });
    const txt = r.content as string;
    expect(txt).toMatch(/##\s+Severity Modifier/i);
    expect(txt).toMatch(/1\.7|×1\.7|x1\.7/);
  });

  it("low-shortfall case returns 1.0× (no modifier applied)", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      severity_modifier: {
        absolute_qaly_shortfall: 6,
        proportional_qaly_shortfall: 0.4,
      },
    });
    const txt = r.content as string;
    expect(txt).toMatch(/1\.0|No modifier/i);
  });

  it("explicitly notes the end-of-life modifier was replaced (April 2022)", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      severity_modifier: {
        absolute_qaly_shortfall: 18,
        proportional_qaly_shortfall: 0.92,
      },
    });
    const txt = r.content as string;
    expect(txt).toMatch(/end[- ]of[- ]life|opportunity[- ]cost[- ]neutral/i);
  });

  it("severity section absent for non-NICE bodies", async () => {
    const r = await handleHtaDossierPrep({
      hta_body: "ema" as const,
      submission_type: "initial" as const,
      drug_name: "x",
      indication: "y",
      evidence_summary: [rctStudy],
      severity_modifier: {
        absolute_qaly_shortfall: 18,
        proportional_qaly_shortfall: 0.92,
      },
    });
    const txt = r.content as string;
    expect(txt).not.toMatch(/##\s+Severity Modifier/i);
  });
});

describe("handleHtaDossierPrep — NICE health inequalities (May 2025 module)", () => {
  it("emits a Health Inequalities section when health_inequalities is provided", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      health_inequalities: {
        affected_groups: ["lower socioeconomic status", "ethnic minorities"],
        baseline_disparity_evidence:
          "Mortality 1.4× higher in IMD quintile 1 vs 5",
        intervention_impact: "narrows",
      },
    });
    const txt = r.content as string;
    expect(txt).toMatch(/##\s+Health Inequalities/i);
    expect(txt).toContain("lower socioeconomic status");
    expect(txt).toMatch(/narrow/i);
  });

  it("intervention that widens inequality is flagged", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      health_inequalities: {
        affected_groups: ["rural population"],
        intervention_impact: "widens",
      },
    });
    const txt = r.content as string;
    expect(txt).toMatch(/widen|⚠️|warning/i);
  });

  it("emits a fallback note when health_inequalities is omitted (NICE only)", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
    });
    const txt = r.content as string;
    expect(txt).toMatch(
      /Health Inequalities not provided|inequalities evidence required|May 2025/i,
    );
  });

  it("references the May 2025 NICE methods modular update", async () => {
    const r = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      health_inequalities: {
        affected_groups: ["x"],
        intervention_impact: "neutral",
      },
    });
    const txt = r.content as string;
    expect(txt).toMatch(/May 2025|PMG36|inequalities methods update/i);
  });
});
