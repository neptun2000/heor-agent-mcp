/**
 * Tests for jca_pico_scope — EU Joint Clinical Assessment PICO matrix
 * analyzer. See design log #13.
 *
 * Inputs: drug + indication + jurisdictions; outputs a structured
 * pico_matrix that pipes directly into hta_dossier({hta_body:"jca"}).
 *
 * Pure decision logic, hardcoded country profiles, <300ms.
 */
import { handleJcaPicoScope } from "../../src/tools/jcaPicoScope.js";
import { handleHtaDossierPrep } from "../../src/tools/htaDossierPrep.js";

interface PicoMatrix {
  drug: string;
  indication: string;
  jca_revision: "2026-05";
  picos: Array<{
    id: string;
    population: string;
    comparator: string;
    outcomes: string[];
  }>;
  country_specific: Array<{
    jurisdiction: string;
    hta_body: string;
    comparators: Array<{
      molecule: string;
      rationale: string;
      outcome_instrument_preferences: string[];
    }>;
    population_subgroups: string[];
    outcome_priorities: string[];
  }>;
  heterogeneity_warning: boolean;
  distinct_comparator_count: number;
  rationale: string;
}

interface JcaResult {
  content: string;
  pico_matrix: PicoMatrix;
}

async function scope(input: Record<string, unknown>): Promise<JcaResult> {
  // For the legacy tests, default to force_proceed_out_of_scope=true so the
  // tool returns the matrix even when the indication is not in JCA scope
  // (Reg 2021/2282 phased rollout — see design log #16). Tests that
  // specifically assert the refusal path pass force_proceed_out_of_scope:false.
  const withForce =
    "force_proceed_out_of_scope" in input
      ? input
      : { ...input, force_proceed_out_of_scope: true };
  return (await handleJcaPicoScope(withForce)) as unknown as JcaResult;
}

// ---- Schema validation ---------------------------------------------------

describe("jca_pico_scope — schema validation", () => {
  it("requires drug, indication, drug_class", async () => {
    await expect(handleJcaPicoScope({})).rejects.toThrow(
      /required|drug|indication|drug_class/i,
    );
  });

  it("accepts the minimal valid input", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
    });
    expect(r.pico_matrix.jca_revision).toBe("2026-05");
    expect(r.pico_matrix.drug).toBe("osimertinib");
  });

  it("rejects unknown drug_class with did-you-mean", async () => {
    await expect(
      scope({
        drug: "x",
        indication: "y",
        drug_class: "small_molecules" as never,
      }),
    ).rejects.toThrow(/small_molecule/);
  });

  it("rejects unknown jurisdiction with did-you-mean", async () => {
    await expect(
      scope({
        drug: "x",
        indication: "y",
        drug_class: "small_molecule",
        jurisdictions: ["germany"] as never,
      }),
    ).rejects.toThrow(/de|jurisdictions/i);
  });

  it("defaults to DE/FR/IT/ES/NL when jurisdictions is omitted", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
    });
    const jx = r.pico_matrix.country_specific.map((c) => c.jurisdiction);
    expect(jx).toEqual(expect.arrayContaining(["de", "fr", "it", "es", "nl"]));
  });
});

// ---- Country coverage (all 5 v1 countries + UK) -------------------------

describe("jca_pico_scope — country coverage", () => {
  it("DE produces a non-empty comparator list for oncology", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    expect(de?.hta_body).toMatch(/G-BA|IQWiG/);
    expect(de?.comparators.length).toBeGreaterThan(0);
  });

  it("FR produces a non-empty comparator list with HAS as the body", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["fr"],
    });
    const fr = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "fr",
    );
    expect(fr?.hta_body).toBe("HAS");
    expect(fr?.comparators.length).toBeGreaterThan(0);
  });

  it("IT body is AIFA", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["it"],
    });
    expect(
      r.pico_matrix.country_specific.find((c) => c.jurisdiction === "it")
        ?.hta_body,
    ).toBe("AIFA");
  });

  it("ES body references AEMPS or RedETS", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["es"],
    });
    expect(
      r.pico_matrix.country_specific.find((c) => c.jurisdiction === "es")
        ?.hta_body,
    ).toMatch(/AEMPS|RedETS/);
  });

  it("NL body is Zorginstituut", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["nl"],
    });
    expect(
      r.pico_matrix.country_specific.find((c) => c.jurisdiction === "nl")
        ?.hta_body,
    ).toMatch(/Zorginstituut/);
  });

  it("UK is flagged as post-Brexit context only", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["uk"],
    });
    const uk = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "uk",
    );
    expect(uk?.hta_body).toMatch(/NICE/);
    expect(String(r.content)).toMatch(/post[- ]Brexit|context only/i);
  });

  it("eu_other returns a placeholder with consult-national-HTA note", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["eu_other"],
    });
    const other = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "eu_other",
    );
    expect(other).toBeDefined();
    expect(String(r.content)).toMatch(/consult.*national HTA/i);
  });
});

// ---- Heterogeneity warning ----------------------------------------------

describe("jca_pico_scope — heterogeneity warning", () => {
  it("fires when ≥3 distinct comparators across jurisdictions", async () => {
    // NSCLC 2L oncology — distinct SoC across DE/FR/IT/ES/NL
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      line_of_therapy: "second_line",
      biomarker_status: "EGFR T790M positive",
      jurisdictions: ["de", "fr", "it", "es", "nl"],
    });
    expect(r.pico_matrix.distinct_comparator_count).toBeGreaterThanOrEqual(3);
    expect(r.pico_matrix.heterogeneity_warning).toBe(true);
  });

  it("does not fire with a single jurisdiction", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    expect(r.pico_matrix.heterogeneity_warning).toBe(false);
  });
});

// ---- Pre-authorisation handling ------------------------------------------

describe("jca_pico_scope — pre-authorisation context", () => {
  it("produces an anticipatory scope with a visible warning", async () => {
    const r = await scope({
      drug: "experimental_drug_x",
      indication: "obesity",
      drug_class: "small_molecule",
      regulatory_context: "pre_authorisation",
      jurisdictions: ["de", "fr"],
    });
    expect(r.pico_matrix.picos.length).toBeGreaterThan(0);
    expect(String(r.content)).toMatch(
      /anticipatory|protocol[- ]design|pre[- ]authorisation/i,
    );
  });
});

// ---- Outcome priorities --------------------------------------------------

describe("jca_pico_scope — outcome priorities", () => {
  it("oncology indications list OS as outcome #1", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    expect(de?.outcome_priorities[0]).toBe("OS");
  });

  it("flags surrogate endpoints (PFS in oncology) as secondary", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    expect(String(r.content)).toMatch(
      /surrogate.*secondary|PFS.*surrogate|JCA scrutiny/i,
    );
  });

  it("non-oncology indication lists patient-relevant outcomes (no OS-first rule)", async () => {
    const r = await scope({
      drug: "guselkumab",
      indication: "ulcerative colitis",
      drug_class: "monoclonal_antibody",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    // For UC, OS is NOT the primary endpoint; remission / HRQoL is.
    expect(de?.outcome_priorities[0]).not.toBe("OS");
  });
});

// ---- Round-trip integration with hta_dossier ----------------------------

describe("jca_pico_scope — pico_matrix.picos pipes into hta_dossier", () => {
  it("output picos[] is accepted by hta_dossier({hta_body:'jca'}) without validation error", async () => {
    const scopeRes = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de", "fr"],
    });
    const dossier = await handleHtaDossierPrep({
      hta_body: "jca",
      submission_type: "initial",
      drug_name: "osimertinib",
      indication: "non-small cell lung cancer",
      picos: scopeRes.pico_matrix.picos,
    });
    expect(typeof dossier.content).toBe("string");
    // Each PICO should appear in the JCA dossier output as a section header
    for (const pico of scopeRes.pico_matrix.picos) {
      expect(String(dossier.content)).toContain(pico.id);
    }
  });
});

// ---- Output content -----------------------------------------------------

describe("jca_pico_scope — output content", () => {
  it("markdown output names jca_revision for auditability", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
    });
    expect(r.content).toMatch(/2026-05|JCA_REVISION/);
  });

  it("markdown output includes a per-country comparator section", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["de", "fr"],
    });
    const t = String(r.content);
    expect(t).toMatch(/##.*Germany|G-BA/i);
    expect(t).toMatch(/##.*France|HAS/i);
  });

  it("references EU HTA Regulation 2021/2282", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
    });
    expect(String(r.content)).toMatch(/2021\/2282|HTA Regulation/i);
  });
});

// ---- Indication classifier — guards against substring overmatch --------

describe("jca_pico_scope — indication classifier robustness", () => {
  // HIGH issue from code review 2026-05-04: the UC branch matched any
  // indication containing the substring "uc", which fired for mucositis,
  // Duchenne, glaucoma, etc. — silently routing those drugs to IBD-UC
  // biologic comparators. Patient-safety-adjacent in a production tool.
  it("'mucositis' must NOT classify as IBD-UC", async () => {
    const r = await scope({
      drug: "x",
      indication: "oral mucositis prophylaxis",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    const molecules = (de?.comparators ?? []).map((c) => c.molecule).join(",");
    expect(molecules).not.toMatch(/vedolizumab|infliximab|ustekinumab/i);
  });

  it("'Duchenne muscular dystrophy' must NOT classify as IBD-UC", async () => {
    const r = await scope({
      drug: "x",
      indication: "Duchenne muscular dystrophy",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    const molecules = (de?.comparators ?? []).map((c) => c.molecule).join(",");
    expect(molecules).not.toMatch(/vedolizumab|infliximab|ustekinumab/i);
  });

  it("'glaucoma' must NOT classify as IBD-UC", async () => {
    const r = await scope({
      drug: "x",
      indication: "primary open-angle glaucoma",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    const molecules = (de?.comparators ?? []).map((c) => c.molecule).join(",");
    expect(molecules).not.toMatch(/vedolizumab|infliximab|ustekinumab/i);
  });

  it("real 'ulcerative colitis' still classifies as IBD-UC (regression guard)", async () => {
    const r = await scope({
      drug: "guselkumab",
      indication: "moderate-to-severe ulcerative colitis",
      drug_class: "monoclonal_antibody",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    const molecules = (de?.comparators ?? []).map((c) => c.molecule).join(",");
    expect(molecules).toMatch(/vedolizumab|infliximab|ustekinumab/i);
  });
});

// ---- Surrogate-endpoint warning fires only for oncology -----------------

describe("jca_pico_scope — surrogate-endpoint warning targeting", () => {
  it("does NOT mention PFS/ORR for non-oncology indication (UC)", async () => {
    const r = await scope({
      drug: "guselkumab",
      indication: "ulcerative colitis",
      drug_class: "monoclonal_antibody",
      jurisdictions: ["de"],
    });
    expect(String(r.content)).not.toMatch(/PFS|ORR|surrogate/i);
  });
});

// ---- NSCLC line-of-therapy warning --------------------------------------

describe("jca_pico_scope — NSCLC line-of-therapy coverage gap warning", () => {
  it("warns when oncology NSCLC is queried with line_of_therapy != second_line", async () => {
    // Code-review feedback: nsclcSecondLineComparators only fires for
    // line_of_therapy="second_line"; otherwise the user gets a generic
    // chemotherapy placeholder with no indication that the detailed
    // EGFR-mutant comparators were skipped. Surface this gap.
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      line_of_therapy: "any",
      jurisdictions: ["de"],
    });
    expect(String(r.content)).toMatch(/2L|second.line|line.of.therapy/i);
  });
});

// ---- Round-trip integration: dossier USES the picos, not just IDs -------

describe("jca_pico_scope — dossier round-trip uses comparator content", () => {
  it("hta_dossier output mentions at least one comparator molecule from pico_matrix.picos", async () => {
    const scopeRes = await scope({
      drug: "guselkumab",
      indication: "ulcerative colitis",
      drug_class: "monoclonal_antibody",
      jurisdictions: ["de", "fr"],
    });
    const dossier = await handleHtaDossierPrep({
      hta_body: "jca",
      submission_type: "initial",
      drug_name: "guselkumab",
      indication: "ulcerative colitis",
      picos: scopeRes.pico_matrix.picos,
    });
    const t = String(dossier.content);
    const hasAnyComparator = scopeRes.pico_matrix.picos.some((p) =>
      t.includes(p.comparator),
    );
    expect(hasAnyComparator).toBe(true);
  });
});

// ---- Performance --------------------------------------------------------

describe("jca_pico_scope — performance", () => {
  it("returns in under 300ms", async () => {
    const start = Date.now();
    await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de", "fr", "it", "es", "nl"],
    });
    expect(Date.now() - start).toBeLessThan(300);
  });
});

// ---- JCA scope eligibility (Reg 2021/2282 phased rollout) ---------------
// New behaviour added in design log #16. Regression guard for the
// management-benchmark gap that Claude.ai exposed.

describe("jca_pico_scope — scope eligibility (Reg 2021/2282)", () => {
  it("refuses cardiovascular small-molecule by default (not in scope until 2030)", async () => {
    const r = (await handleJcaPicoScope({
      drug: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction",
      drug_class: "small_molecule",
    })) as unknown as { content: string; pico_matrix: unknown };
    expect(r.pico_matrix).toBeNull();
    const t = r.content.toLowerCase();
    expect(t).toMatch(/not (currently )?in jca scope|not yet in jca scope/);
    expect(t).toMatch(/2030/);
    expect(t).toMatch(/regulation \(eu\) 2021\/2282|reg 2021\/2282/);
  });

  it("flags 2028 entry year for orphan-designated products", async () => {
    const r = (await handleJcaPicoScope({
      drug: "rare-disease-drug",
      indication: "ultra-rare metabolic disease",
      drug_class: "small_molecule",
      is_orphan: true,
    })) as unknown as { content: string; pico_matrix: unknown };
    expect(r.pico_matrix).toBeNull();
    expect(r.content).toMatch(/2028/);
  });

  it("oncology IS in scope (Phase 1 since 12 Jan 2025)", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      // No force_proceed_out_of_scope needed — oncology is in scope.
      force_proceed_out_of_scope: false,
    });
    expect(r.pico_matrix).not.toBeNull();
  });

  it("ATMP IS in scope regardless of indication (Phase 1)", async () => {
    const r = await scope({
      drug: "kymriah",
      indication: "diffuse large B-cell lymphoma",
      drug_class: "atmp_cell",
      force_proceed_out_of_scope: false,
    });
    expect(r.pico_matrix).not.toBeNull();
  });

  it("force_proceed_out_of_scope=true emits matrix with explicit warning", async () => {
    const r = (await handleJcaPicoScope({
      drug: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction",
      drug_class: "small_molecule",
      force_proceed_out_of_scope: true,
    })) as unknown as { content: string; pico_matrix: unknown };
    expect(r.pico_matrix).not.toBeNull();
  });
});

// ---- Per-country HFrEF comparator depth (design log #18) ---------------
// Closes the remaining Slide 7 gap vs Claude.ai: HEORAgent now produces
// per-country zVT detail for cardiovascular_hfref instead of the generic
// "country-specific SoC" placeholder.

describe("jca_pico_scope — cardiovascular HFrEF per-country depth", () => {
  it("classifies HFrEF as cardiovascular_hfref (not generic cardiovascular)", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    // Indication category exposed via the matrix
    const matrix = r.pico_matrix as unknown as {
      indication_category: string;
    };
    expect(matrix.indication_category).toBe("cardiovascular_hfref");
  });

  it("DE returns 3 zVT-style scenarios (ACEi/ARB GDMT, ARNI GDMT, empagliflozin)", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "HFrEF",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    expect(de).toBeDefined();
    expect(de!.comparators.length).toBeGreaterThanOrEqual(3);
    const molecules = de!.comparators.map((c) => c.molecule).join(" | ");
    expect(molecules).toMatch(/ACEi.ARB-based GDMT/);
    expect(molecules).toMatch(/ARNI-based GDMT/);
    expect(molecules.toLowerCase()).toMatch(/empagliflozin/);
  });

  it("FR distinguishes SMR vs ASMR comparators", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction",
      drug_class: "small_molecule",
      jurisdictions: ["fr"],
    });
    const fr = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "fr",
    );
    const t = (fr?.comparators ?? [])
      .map((c) => `${c.molecule} :: ${c.rationale}`)
      .join("\n");
    expect(t).toMatch(/SMR/);
    expect(t).toMatch(/ASMR/);
  });

  it("NL splits ARNI-eligible vs ARNI-ineligible patients", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "reduced ejection fraction",
      drug_class: "small_molecule",
      jurisdictions: ["nl"],
    });
    const nl = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "nl",
    );
    const t = (nl?.comparators ?? []).map((c) => `${c.molecule}`).join(" | ");
    expect(t.toLowerCase()).toMatch(/arni-eligible/);
    expect(t.toLowerCase()).toMatch(/arni-ineligible/);
  });

  it("ES references Spanish IPT 1L/2L stepwise positioning", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "HFrEF",
      drug_class: "small_molecule",
      jurisdictions: ["es"],
    });
    const es = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "es",
    );
    const t = (es?.comparators ?? [])
      .map((c) => `${c.molecule} :: ${c.rationale}`)
      .join("\n");
    expect(t).toMatch(/Spanish IPT|IPT/);
  });

  it("HFrEF outcomes prioritise CV death + HF hospitalization (not generic 'remission')", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "HFrEF",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    const outcomes = (de?.outcome_priorities ?? []).join(",");
    expect(outcomes).toMatch(/CV_death/);
    expect(outcomes).toMatch(/HF_hospitalization/);
  });

  it("does NOT regress the generic cardiovascular branch (e.g., hypertension)", async () => {
    const r = await scope({
      drug: "drugX",
      indication: "hypertension",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const matrix = r.pico_matrix as unknown as {
      indication_category: string;
    };
    expect(matrix.indication_category).toBe("cardiovascular");
  });

  it("triggers heterogeneity warning when multi-country HFrEF returns ≥3 distinct comparators", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "HFrEF",
      drug_class: "small_molecule",
      jurisdictions: ["de", "fr", "it", "es", "nl"],
    });
    expect(r.pico_matrix.heterogeneity_warning).toBe(true);
    expect(r.pico_matrix.distinct_comparator_count).toBeGreaterThanOrEqual(3);
  });
});

// ---- NICE TA precedent surfacing in hta_dossier ------------------------
// Closes the TA902 vs TA679 prompt-error gap exposed by the management
// benchmark — see design log #16.

describe("hta_dossier (nice) — NICE TA precedent surfacing", () => {
  it("surfaces canonical TA679 for dapagliflozin HFrEF", async () => {
    const r = await handleHtaDossierPrep({
      hta_body: "nice",
      submission_type: "sta",
      drug_name: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction (HFrEF)",
    });
    const t = String(r.content);
    expect(t).toMatch(/TA679/);
    expect(t).toMatch(/Relevant NICE Technology Appraisal/);
  });

  it("surfaces canonical TA902 for dapagliflozin HFpEF", async () => {
    const r = await handleHtaDossierPrep({
      hta_body: "nice",
      submission_type: "sta",
      drug_name: "dapagliflozin",
      indication: "heart failure with preserved ejection fraction (HFpEF)",
    });
    const t = String(r.content);
    expect(t).toMatch(/TA902/);
  });

  it("flags TA mismatch when user prose cites the wrong TA number", async () => {
    const r = await handleHtaDossierPrep({
      hta_body: "nice",
      submission_type: "sta",
      drug_name: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction (HFrEF)",
      evidence_summary: "Per NICE TA902 the recommended dose is 10mg daily.",
    });
    const t = String(r.content);
    expect(t).toMatch(/TA mismatch detected/);
    expect(t).toMatch(/TA902/);
    expect(t).toMatch(/TA679/);
  });
});

// ── v1.4.2 code-review regression tests ───────────────────────────────

import { jcaPicoScopeToolSchema as jcaSchemaForTests } from "../../src/tools/jcaPicoScope.js";
import {
  extractTaNumber as extractTaNumberFn,
  extractAllTaNumbers as extractAllTaNumbersFn,
  findPrecedents as findPrecedentsFn,
} from "../../src/data/niceTaPrecedents.js";

describe("jca_pico_scope — v1.4.2 fixes", () => {
  it("scopeEligibility source does not contain the buggy '12 January 2025' date (regression guard)", () => {
    // Bug fixed in v1.4.2: file referenced "12 January 2025" instead of
    // "13 January 2025" (Reg 2021/2282 Article 34) in three places.
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/jca/scopeEligibility.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/12 January 2025/);
    expect(src).toMatch(/13 January 2025/);
  });

  it("inputSchema advertises is_orphan + force_proceed_out_of_scope so MCP clients can discover them", () => {
    const props = (
      jcaSchemaForTests as unknown as {
        inputSchema: { properties: Record<string, unknown> };
      }
    ).inputSchema.properties;
    expect(props).toHaveProperty("is_orphan");
    expect(props).toHaveProperty("force_proceed_out_of_scope");
  });

  it("HFrEF outcome priorities lead with the composite primary endpoint", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    expect(de?.outcome_priorities[0]).toBe("CV_death_or_HF_hospitalization");
  });

  it("HFrEF instrument list includes KCCQ-12 (mandatory per EUnetHTA Annex II)", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    const allInstruments = (de?.comparators ?? []).flatMap(
      (c) => c.outcome_instrument_preferences,
    );
    expect(allInstruments).toContain("KCCQ-12");
  });

  it("HFrEF subgroups include NYHA class, LVEF stratum, and ARNI eligibility", async () => {
    const r = await scope({
      drug: "dapagliflozin",
      indication: "heart failure with reduced ejection fraction",
      drug_class: "small_molecule",
      jurisdictions: ["nl"],
    });
    const nl = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "nl",
    );
    expect(nl?.population_subgroups.join(" ")).toMatch(/NYHA/i);
    expect(nl?.population_subgroups.join(" ")).toMatch(/LVEF/i);
    expect(nl?.population_subgroups.join(" ")).toMatch(/ARNI/i);
  });

  it("bare 'heart failure' (no EF qualifier) emits an ambiguity warning", async () => {
    const r = await scope({
      drug: "drugX",
      indication: "heart failure",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const t = String(r.content);
    expect(t).toMatch(/ambiguous|HFpEF.*HFrEF|specific phenotype/i);
  });
});

describe("extractTaNumber regex robustness (v1.4.2)", () => {
  it("matches 'TA679' (no space)", () => {
    expect(extractTaNumberFn("Per TA679 the recommended dose is...")).toBe(
      "TA679",
    );
  });

  it("matches 'TA 679' (with space) — common in NICE prose", () => {
    expect(extractTaNumberFn("As outlined in NICE TA 773.")).toBe("TA773");
  });

  it("extractAllTaNumbers picks up multiple TA citations in one prose", () => {
    const list = extractAllTaNumbersFn(
      "Per TA902 for HFpEF and TA 679 for HFrEF.",
    );
    expect(list).toContain("TA902");
    expect(list).toContain("TA679");
  });
});

describe("findPrecedents drug match — word-boundary, not substring (v1.4.2)", () => {
  it("'valsartan' (ARB) does NOT match 'sacubitril valsartan' (ARNI) precedent", () => {
    const matches = findPrecedentsFn("valsartan", "heart failure HFrEF");
    expect(matches.find((p) => p.ta_number === "TA388")).toBeUndefined();
  });

  it("'sacubitril valsartan' does match TA388", () => {
    const matches = findPrecedentsFn(
      "sacubitril valsartan",
      "heart failure HFrEF",
    );
    expect(matches.find((p) => p.ta_number === "TA388")).toBeDefined();
  });
});
