/**
 * Tests for irb_review — IRB / Ethics Committee submission classifier.
 *
 * Per design log #21: classifies a planned study under 45 CFR 46 (US Common
 * Rule) + EU CTR 536/2014 + GDPR Art. 9 + HIPAA §164.514 + SAE-reporting
 * obligations + ICF complexity tier + COI framework + ready-to-paste cover
 * letter. Pure decision-tree logic, <300ms, no I/O.
 *
 * Verification criteria from design log #21:
 *   - All 8 Common Rule exempt categories (45 CFR 46.104 cat 1-8) reachable
 *   - All 7 expedited categories (§46.110 cat 1-7) reachable
 *   - Full-board path produces correct rationale
 *   - Subpart B (pregnant) / C (prisoners) / D (children) obligations layer
 *   - GDPR Art. 9 fires only when EU jurisdiction + non-anonymous data
 *   - CTR 536/2014 multi-state timeline (~60d) on interventional+multi+EU
 *   - pv_classification input wires through (PASS_imposed → CTR Annex III)
 *   - Cover-letter template ≥150 / ≤500 words including drug, indication,
 *     review tier, COI status
 *   - irb_ruleset: "2026-05" always stamped
 *   - <300ms response on representative inputs
 *
 * Plus 4 sign-off ambiguities (A1-A4):
 *   A1: multi-jurisdiction null shape (only-US → review_tier_eu = null)
 *   A2: expedited_category_claim mismatch surfaces both (claim vs analysis)
 *   A3: risk_level="unknown" → conservative full-board + warning
 *   A4: ICF tier rule
 *     basic    = minimal-risk + no vulnerable + non-interventional
 *     complex  = full-board OR any vulnerable group
 *     standard = everything else
 */
import {
  handleIrbReview,
  type IrbAssessment,
} from "../../src/tools/irbReview.js";

interface IrbResult {
  content: string;
  irb_assessment: IrbAssessment;
}

async function review(input: Record<string, unknown>): Promise<IrbResult> {
  return (await handleIrbReview(input)) as unknown as IrbResult;
}

const MINIMAL_INTERVENTIONAL = {
  study_design: "interventional",
  intervention: "elranatamab",
  indication: "relapsed multiple myeloma",
  data_handling: "pseudonymized",
  risk_level: "greater_than_minimal",
  funding_source: "industry",
  jurisdictions: ["us_irb", "eu_cec"],
  multi_site: true,
};

const MINIMAL_RETROSPECTIVE = {
  study_design: "retrospective_chart_review",
  intervention: "metformin",
  indication: "type 2 diabetes",
  data_handling: "anonymized_safe_harbor",
  risk_level: "minimal",
  funding_source: "academic",
  jurisdictions: ["us_irb"],
};

// ---- Schema validation -------------------------------------------------

describe("irb_review — schema validation", () => {
  it("requires study_design, intervention, indication, data_handling, funding_source", async () => {
    await expect(handleIrbReview({})).rejects.toThrow(
      /required|study_design|intervention|indication|data_handling|funding_source/i,
    );
  });

  it("accepts the minimal valid input", async () => {
    const r = await review(MINIMAL_RETROSPECTIVE);
    expect(r.irb_assessment.review_tier_us).toBeDefined();
    expect(r.irb_assessment.irb_ruleset).toBe("2026-05");
  });

  it("rejects an unknown study_design with did-you-mean", async () => {
    await expect(
      review({
        ...MINIMAL_RETROSPECTIVE,
        study_design: "interventional_drug" as never,
      }),
    ).rejects.toThrow(/study_design|interventional/i);
  });

  it("rejects an unknown jurisdiction with did-you-mean", async () => {
    await expect(
      review({
        ...MINIMAL_RETROSPECTIVE,
        jurisdictions: ["us"] as never,
      }),
    ).rejects.toThrow(/jurisdictions|us_irb/i);
  });

  it("rejects an unknown data_handling enum", async () => {
    await expect(
      review({
        ...MINIMAL_RETROSPECTIVE,
        data_handling: "deidentified" as never,
      }),
    ).rejects.toThrow(/data_handling|anonymized|safe_harbor/i);
  });
});

// ---- Common Rule exempt categories (45 CFR 46.104 cat 1-8) -------------

describe("irb_review — exempt categories §46.104 (1-8) all reachable", () => {
  it("cat 1: educational practices (questionnaire_only, low risk, education context)", async () => {
    const r = await review({
      study_design: "questionnaire_only",
      intervention: "classroom curriculum study",
      indication: "educational outcomes",
      data_handling: "anonymized_safe_harbor",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      exempt_category_hint: "educational",
    });
    expect(r.irb_assessment.review_tier_us).toBe("exempt");
    expect(r.irb_assessment.exempt_category_us).toBe(1);
  });

  it("cat 2: educational tests / surveys / interviews / public observation (anonymous)", async () => {
    // §46.104(d)(2) requires non-identifiability OR no-disclosure-risk.
    // Anonymous responses cleanly satisfy the first condition; identifiable
    // questionnaires fall to expedited cat 7 (covered separately below).
    const r = await review({
      study_design: "questionnaire_only",
      intervention: "patient experience survey",
      indication: "diabetes care quality",
      data_handling: "anonymized_safe_harbor",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("exempt");
    expect(r.irb_assessment.exempt_category_us).toBe(2);
  });

  it("cat 3: benign behavioural interventions in adults", async () => {
    const r = await review({
      study_design: "interventional",
      intervention: "5-minute breathing exercise app",
      indication: "stress reduction",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      benign_behavioural: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("exempt");
    expect(r.irb_assessment.exempt_category_us).toBe(3);
  });

  it("cat 4: secondary research with identifiable info / biospecimens (de-id)", async () => {
    const r = await review({
      study_design: "secondary_data_analysis",
      intervention: "metformin",
      indication: "T2D",
      data_handling: "anonymized_safe_harbor",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("exempt");
    expect(r.irb_assessment.exempt_category_us).toBe(4);
  });

  it("cat 5: federal demonstration projects", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "Medicare ACO benefit design",
      indication: "chronic disease management",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "other_government",
      jurisdictions: ["us_irb"],
      federal_demonstration: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("exempt");
    expect(r.irb_assessment.exempt_category_us).toBe(5);
  });

  it("cat 6: taste / food evaluation", async () => {
    const r = await review({
      study_design: "interventional",
      intervention: "low-sodium food preference test",
      indication: "dietary acceptability",
      data_handling: "anonymized_safe_harbor",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      taste_test: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("exempt");
    expect(r.irb_assessment.exempt_category_us).toBe(6);
  });

  it("cat 7: storage / maintenance for secondary research with broad consent", async () => {
    const r = await review({
      study_design: "specimen_repository",
      intervention: "biobank for future cardiometabolic research",
      indication: "biospecimen storage",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "nih",
      jurisdictions: ["us_irb"],
      broad_consent_obtained: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("exempt");
    expect(r.irb_assessment.exempt_category_us).toBe(7);
  });

  it("cat 8: secondary research with broad consent", async () => {
    const r = await review({
      study_design: "secondary_data_analysis",
      intervention: "biobank-derived genomic analysis",
      indication: "T2D genetics",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "nih",
      jurisdictions: ["us_irb"],
      broad_consent_obtained: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("exempt");
    expect(r.irb_assessment.exempt_category_us).toBe(8);
  });
});

// ---- Expedited categories §46.110 (1-7) ---------------------------------

describe("irb_review — expedited categories §46.110 (1-7) all reachable", () => {
  it("cat 1: minor changes to drugs/devices for already-marketed product, minimal risk", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "post-marketing label-expansion observation",
      indication: "T2D",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "industry",
      jurisdictions: ["us_irb"],
      marketed_drug: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toContain(1);
  });

  it("cat 2: blood draws within volume limits", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "biomarker venous blood draw, 50 mL total",
      indication: "T2D",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      blood_draw_within_limits: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toContain(2);
  });

  it("cat 3: prospective biospecimen collection by noninvasive means", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "saliva and hair sample collection",
      indication: "drug metabolism",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      noninvasive_collection: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toContain(3);
  });

  it("cat 4: data collected through noninvasive procedures", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "ECG and blood pressure monitoring",
      indication: "cardiovascular health",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      noninvasive_procedure: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toContain(4);
  });

  it("cat 5: research using existing data, documents, records, specimens (identifiable)", async () => {
    const r = await review({
      study_design: "retrospective_chart_review",
      intervention: "EHR-based cohort",
      indication: "heart failure outcomes",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toContain(5);
  });

  it("cat 6: voice / digital / image recordings", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "telehealth consultation video recording",
      indication: "clinical communication study",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      recording_collection: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toContain(6);
  });

  it("cat 7: research using survey/interview/focus groups in adults, minimal risk, identifiable", async () => {
    const r = await review({
      study_design: "questionnaire_only",
      intervention: "qualitative patient experience interviews",
      indication: "treatment burden in cancer",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toContain(7);
  });
});

// ---- Full-board path ----------------------------------------------------

describe("irb_review — full-board path", () => {
  it("greater-than-minimal-risk interventional drug → full board", async () => {
    const r = await review(MINIMAL_INTERVENTIONAL);
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
    expect(r.irb_assessment.rationale).toMatch(
      /full[- ]board|greater[- ]than[- ]minimal|46\.108/i,
    );
  });

  it("rationale cites §46.108 or analogous regulatory basis", async () => {
    const r = await review(MINIMAL_INTERVENTIONAL);
    expect(r.irb_assessment.rationale).toMatch(/45 CFR 46|46\.108|full board/i);
  });
});

// ---- Vulnerable populations (Subpart B/C/D) -----------------------------

describe("irb_review — vulnerable population obligations", () => {
  it("Subpart B (pregnant women) emits when population_includes_pregnant=true", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      population_includes_pregnant: true,
    });
    const groups = r.irb_assessment.vulnerable_population_obligations.map(
      (g) => g.group,
    );
    expect(groups).toContain("pregnant");
    const pregnant = r.irb_assessment.vulnerable_population_obligations.find(
      (g) => g.group === "pregnant",
    );
    expect(pregnant?.regulatory_basis).toMatch(/Subpart B/);
  });

  it("Subpart C (prisoners) emits when population_includes_prisoners=true", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      population_includes_prisoners: true,
    });
    const prisoners = r.irb_assessment.vulnerable_population_obligations.find(
      (g) => g.group === "prisoners",
    );
    expect(prisoners).toBeDefined();
    expect(prisoners?.regulatory_basis).toMatch(/Subpart C/);
  });

  it("Subpart D (children) emits when population_includes_pediatric=true with v2_age_tier_table_pending=true", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      population_includes_pediatric: true,
    });
    const peds = r.irb_assessment.vulnerable_population_obligations.find(
      (g) => g.group === "pediatric",
    );
    expect(peds).toBeDefined();
    expect(peds?.regulatory_basis).toMatch(/Subpart D/);
    expect(peds?.v2_age_tier_table_pending).toBe(true);
  });

  it("decisionally impaired emits with regulatory basis", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      population_includes_decisionally_impaired: true,
    });
    const di = r.irb_assessment.vulnerable_population_obligations.find(
      (g) => g.group === "decisionally_impaired",
    );
    expect(di).toBeDefined();
    expect(di?.obligations.length).toBeGreaterThan(0);
  });

  it("no vulnerable groups → empty obligations array", async () => {
    const r = await review(MINIMAL_INTERVENTIONAL);
    expect(r.irb_assessment.vulnerable_population_obligations).toHaveLength(0);
  });
});

// ---- Data Management Plan (GDPR / HIPAA) -------------------------------

describe("irb_review — data management plan", () => {
  it("GDPR Art. 9 fires when EU jurisdiction + pseudonymized data", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["eu_cec"],
      data_handling: "pseudonymized",
    });
    expect(r.irb_assessment.data_management_plan.gdpr_special_category).toBe(
      true,
    );
  });

  it("GDPR Art. 9 does NOT fire when EU + aggregate_only", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["eu_cec"],
      data_handling: "aggregate_only",
    });
    expect(r.irb_assessment.data_management_plan.gdpr_special_category).toBe(
      false,
    );
  });

  it("GDPR Art. 9 does NOT fire when only US jurisdiction", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["us_irb"],
      data_handling: "pseudonymized",
    });
    expect(r.irb_assessment.data_management_plan.gdpr_special_category).toBe(
      false,
    );
  });

  it("HIPAA PHI flag fires when US + identifiable", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["us_irb"],
      data_handling: "fully_identifiable",
    });
    expect(r.irb_assessment.data_management_plan.hipaa_phi).toBe(true);
    expect(r.irb_assessment.data_management_plan.de_identification_method).toBe(
      "must_implement",
    );
  });

  it("HIPAA Safe Harbor surfaces when US + anonymized_safe_harbor", async () => {
    const r = await review({
      ...MINIMAL_RETROSPECTIVE,
      data_handling: "anonymized_safe_harbor",
    });
    expect(r.irb_assessment.data_management_plan.de_identification_method).toBe(
      "safe_harbor",
    );
  });

  it("Expert Determination surfaces when anonymized_expert_determination", async () => {
    const r = await review({
      ...MINIMAL_RETROSPECTIVE,
      data_handling: "anonymized_expert_determination",
    });
    expect(r.irb_assessment.data_management_plan.de_identification_method).toBe(
      "expert_determination",
    );
  });
});

// ---- SAE reporting framework -------------------------------------------

describe("irb_review — SAE reporting", () => {
  it("interventional + EU + multi-site → CTR 536/2014 Annex III", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["eu_cec"],
      multi_site: true,
    });
    expect(r.irb_assessment.sae_reporting_obligations.framework).toBe(
      "ctr_536_2014",
    );
    const fatal = r.irb_assessment.sae_reporting_obligations.timelines.find(
      (t) => /fatal|life[- ]threatening/i.test(t.event_type),
    );
    expect(fatal?.reporting_window).toMatch(/7\s*day/i);
  });

  it("interventional + US only → FDA IND Safety reporting", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.sae_reporting_obligations.framework).toBe(
      "fda_ind_safety",
    );
  });

  it("non-interventional + post-marketing → PSUR framework", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "marketed drug observational",
      indication: "T2D",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "industry",
      jurisdictions: ["eu_cec"],
      marketed_drug: true,
    });
    expect(r.irb_assessment.sae_reporting_obligations.framework).toBe(
      "post_marketing_psur",
    );
  });

  it("retrospective chart review with anonymized data → no SAE framework", async () => {
    const r = await review(MINIMAL_RETROSPECTIVE);
    expect(r.irb_assessment.sae_reporting_obligations.framework).toBe("none");
  });
});

// ---- pv_classification integration -------------------------------------

describe("irb_review — pv_classification integration", () => {
  it("PASS_imposed input → CTR Annex III SAE timelines visible regardless of jurisdiction", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["us_irb"],
      pv_classification: { primary_category: "PASS_imposed" },
    });
    expect(r.irb_assessment.sae_reporting_obligations.framework).toBe(
      "ctr_536_2014",
    );
    expect(r.irb_assessment.rationale).toMatch(/PASS.*imposed|107n/i);
  });

  it("rationale references the PV category when pv_classification is supplied", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      pv_classification: { primary_category: "PAES" },
    });
    expect(r.irb_assessment.rationale).toMatch(/PAES|post[- ]authorisation/i);
  });
});

// ---- ICF complexity tier (A4) ------------------------------------------

describe("irb_review — ICF complexity tier (A4)", () => {
  it("basic: minimal risk + no vulnerable + non-interventional", async () => {
    const r = await review({
      study_design: "questionnaire_only",
      intervention: "patient experience survey",
      indication: "diabetes care",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.icf_complexity_tier).toBe("basic");
  });

  it("complex: full-board path triggers complex tier", async () => {
    const r = await review(MINIMAL_INTERVENTIONAL);
    expect(r.irb_assessment.icf_complexity_tier).toBe("complex");
  });

  it("complex: any vulnerable population (pediatric) triggers complex tier", async () => {
    const r = await review({
      ...MINIMAL_RETROSPECTIVE,
      population_includes_pediatric: true,
    });
    expect(r.irb_assessment.icf_complexity_tier).toBe("complex");
  });

  it("standard: greater_than_minimal-risk non-interventional, no vulnerable groups", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "marketed drug observational",
      indication: "T2D",
      data_handling: "pseudonymized",
      risk_level: "greater_than_minimal",
      funding_source: "industry",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.icf_complexity_tier).toBe("standard");
  });
});

// ---- COI framework -----------------------------------------------------

describe("irb_review — COI framework", () => {
  it("industry funding + US → PHS 42 CFR 50 Subpart F applies", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["us_irb"],
      funding_source: "industry",
    });
    expect(r.irb_assessment.coi_disclosure_required).toBe(true);
    expect(r.irb_assessment.coi_framework).toMatch(/phs|42 CFR 50/);
  });

  it("industry funding + EU → EU CTR Annex I §M Point 66 applies (v1.5.1: was Article 14)", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["eu_cec"],
      funding_source: "industry",
    });
    expect(r.irb_assessment.coi_disclosure_required).toBe(true);
    expect(r.irb_assessment.coi_framework).toBe("eu_ctr_annex_i_point_66");
  });

  it("industry + US + EU → both frameworks apply", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      funding_source: "industry",
    });
    expect(r.irb_assessment.coi_framework).toBe("both");
  });

  it("academic funding only → no COI obligation", async () => {
    const r = await review(MINIMAL_RETROSPECTIVE);
    expect(r.irb_assessment.coi_disclosure_required).toBe(false);
    expect(r.irb_assessment.coi_framework).toBe("none");
  });
});

// ---- Cover-letter template ---------------------------------------------

describe("irb_review — cover-letter template", () => {
  it("includes drug, indication, review tier, and COI status", async () => {
    const r = await review(MINIMAL_INTERVENTIONAL);
    const tpl = r.irb_assessment.cover_letter_template;
    expect(tpl).toMatch(/elranatamab/i);
    expect(tpl).toMatch(/relapsed multiple myeloma/i);
    expect(tpl).toMatch(/full[- ]board/i);
    expect(tpl).toMatch(/conflict|coi|disclosure/i);
  });

  it("template length is between 150 and 500 words", async () => {
    const r = await review(MINIMAL_INTERVENTIONAL);
    const wordCount = r.irb_assessment.cover_letter_template
      .trim()
      .split(/\s+/).length;
    expect(wordCount).toBeGreaterThanOrEqual(150);
    expect(wordCount).toBeLessThanOrEqual(500);
  });
});

// ---- Multi-jurisdiction shape (A1) -------------------------------------

describe("irb_review — multi-jurisdiction output shape (A1)", () => {
  it("US-only jurisdictions → review_tier_eu is null", async () => {
    const r = await review(MINIMAL_RETROSPECTIVE);
    expect(r.irb_assessment.review_tier_eu).toBeNull();
    expect(r.irb_assessment.eu_cec_timeline_days).toBeNull();
  });

  it("EU-only jurisdictions → review_tier_us is null", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["eu_cec"],
    });
    expect(r.irb_assessment.review_tier_us).toBeNull();
    expect(r.irb_assessment.exempt_category_us).toBeNull();
    expect(r.irb_assessment.expedited_categories_us).toEqual([]);
  });

  it("Both jurisdictions → both populated", async () => {
    const r = await review(MINIMAL_INTERVENTIONAL);
    expect(r.irb_assessment.review_tier_us).not.toBeNull();
    expect(r.irb_assessment.review_tier_eu).not.toBeNull();
  });
});

// ---- expedited_category_claim mismatch (A2) ----------------------------

describe("irb_review — expedited_category_claim mismatch surfaces both (A2)", () => {
  it("user claims [2] but logic concludes [5] → both surfaced in advisory_warnings", async () => {
    const r = await review({
      study_design: "retrospective_chart_review",
      intervention: "EHR cohort",
      indication: "T2D",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      expedited_category_claim: [2],
    });
    expect(r.irb_assessment.expedited_categories_us).toContain(5);
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).toMatch(/claim|claimed|category/i);
    expect(warnings).toMatch(/\b2\b/);
    expect(warnings).toMatch(/\b5\b/);
  });

  it("user claim matches logic → no mismatch warning", async () => {
    const r = await review({
      study_design: "retrospective_chart_review",
      intervention: "EHR cohort",
      indication: "T2D",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      expedited_category_claim: [5],
    });
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).not.toMatch(/claim.*mismatch|claimed.*differs/i);
  });
});

// ---- risk_level "unknown" conservative default (A3) --------------------

describe("irb_review — risk_level 'unknown' conservative (A3)", () => {
  it("interventional + risk_level=unknown → full board + warning", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      risk_level: "unknown",
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).toMatch(
      /risk_level.*(unknown|missing|conservative|defaulted)/i,
    );
  });
});

// ---- irb_ruleset stamp -------------------------------------------------

describe("irb_review — irb_ruleset stamp", () => {
  it("always emits irb_ruleset='2026-05'", async () => {
    const r1 = await review(MINIMAL_INTERVENTIONAL);
    const r2 = await review(MINIMAL_RETROSPECTIVE);
    expect(r1.irb_assessment.irb_ruleset).toBe("2026-05");
    expect(r2.irb_assessment.irb_ruleset).toBe("2026-05");
  });
});

// ---- Performance --------------------------------------------------------

describe("irb_review — performance", () => {
  it("runs <300ms on representative input", async () => {
    const start = Date.now();
    await review(MINIMAL_INTERVENTIONAL);
    expect(Date.now() - start).toBeLessThan(300);
  });
});

// ---- v1.5.1 code-review regression tests --------------------------------
//
// Surfaced by 3 parallel reviewers (regulatory accuracy via WebFetch
// verification, decision-tree correctness, test-gap analysis). Each fix is
// pinned by a regression test so a future refactor cannot silently revert.

describe("irb_review — v1.5.1 regulatory citation fixes", () => {
  it("pregnant women obligation cites §46.204(e) and 'solely to the fetus' trigger", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      population_includes_pregnant: true,
    });
    const pregnant = r.irb_assessment.vulnerable_population_obligations.find(
      (g) => g.group === "pregnant",
    );
    const obligationsText = pregnant?.obligations.join(" ") ?? "";
    expect(obligationsText).toMatch(/§46\.204\(e\)/);
    expect(obligationsText).toMatch(/solely to the fetus/i);
    // Pre-fix wording had "no direct benefit" as the trigger — make sure
    // we don't regress.
    expect(obligationsText).not.toMatch(
      /Both parents' consent required when research holds no direct benefit/i,
    );
  });

  it("prisoner obligation enumerates §46.306(a)(2)(i-iv) and identifies (iv) as individual-subject", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      population_includes_prisoners: true,
    });
    const prisoners = r.irb_assessment.vulnerable_population_obligations.find(
      (g) => g.group === "prisoners",
    );
    const obligationsText = prisoners?.obligations.join(" ") ?? "";
    expect(obligationsText).toMatch(/§46\.306\(a\)\(2\)\(i-iv\)/);
    expect(obligationsText).toMatch(/individual subject/i);
    expect(obligationsText).toMatch(/prisoners as a class/i);
  });

  it("pediatric obligation cites §46.406(c) generalizable-knowledge condition", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      population_includes_pediatric: true,
    });
    const peds = r.irb_assessment.vulnerable_population_obligations.find(
      (g) => g.group === "pediatric",
    );
    const obligationsText = peds?.obligations.join(" ") ?? "";
    expect(obligationsText).toMatch(/§46\.406\(c\)/);
    expect(obligationsText).toMatch(/generalizable knowledge/i);
    expect(obligationsText).toMatch(/disorder or condition/i);
  });

  it("cover letter for industry+EU cites 'Annex I' (not 'Article 14') for COI", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["eu_cec"],
    });
    expect(r.irb_assessment.cover_letter_template).toMatch(/Annex I/);
    // Article 14 is "Addition of a Member State" — verified against
    // legislation.gov.uk; using it for COI was the v1.5.0 bug.
    expect(r.irb_assessment.cover_letter_template).not.toMatch(/Article 14/);
  });

  it("HIPAA DMP cross-border obligations cite §164.514(b)(1) and (b)(2)", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["us_irb"],
      data_handling: "fully_identifiable",
    });
    const xfer =
      r.irb_assessment.data_management_plan.cross_border_transfer_obligations.join(
        " ",
      );
    expect(xfer).toMatch(/§164\.514\(b\)\(2\)/);
    expect(xfer).toMatch(/§164\.514\(b\)\(1\)/);
  });
});

describe("irb_review — v1.5.1 decision-tree correctness fixes", () => {
  it("NIH funding + US → coi_framework='phs_42_cfr_50', required=true (v1.5.1: was 'none')", async () => {
    const r = await review({
      ...MINIMAL_RETROSPECTIVE,
      funding_source: "nih",
    });
    expect(r.irb_assessment.coi_disclosure_required).toBe(true);
    expect(r.irb_assessment.coi_framework).toBe("phs_42_cfr_50");
  });

  it("other_government funding + US → coi_framework='phs_42_cfr_50' (CDC/AHRQ etc.)", async () => {
    const r = await review({
      ...MINIMAL_RETROSPECTIVE,
      funding_source: "other_government",
    });
    expect(r.irb_assessment.coi_disclosure_required).toBe(true);
    expect(r.irb_assessment.coi_framework).toBe("phs_42_cfr_50");
  });

  it("academic funding + US → no COI (academic-only is correctly excluded)", async () => {
    const r = await review(MINIMAL_RETROSPECTIVE);
    expect(r.irb_assessment.coi_disclosure_required).toBe(false);
    expect(r.irb_assessment.coi_framework).toBe("none");
  });

  it("foundation funding + EU → no COI (CTR Annex I §M Point 66 only fires for industry sponsors)", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["eu_cec"],
      funding_source: "foundation",
    });
    expect(r.irb_assessment.coi_disclosure_required).toBe(false);
  });

  it("nih + EU only → phs_42_cfr_50 does not apply (no us_irb), CTR Annex I requires industry", async () => {
    const r = await review({
      ...MINIMAL_INTERVENTIONAL,
      jurisdictions: ["eu_cec"],
      funding_source: "nih",
    });
    expect(r.irb_assessment.coi_disclosure_required).toBe(false);
  });

  it("interventional full-board rationale text NEVER falsely asserts 'greater-than-minimal' when risk_level='minimal'", async () => {
    const r = await review({
      study_design: "interventional",
      intervention: "x",
      indication: "y",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "industry",
      jurisdictions: ["us_irb"],
      // No marketed_drug hint → falls through to full_board
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
    expect(r.irb_assessment.rationale).not.toMatch(
      /at greater-than-minimal risk/,
    );
    expect(r.irb_assessment.rationale).toMatch(/marketed_drug=true|hint/i);
  });

  it("retrospective_chart_review + risk_level='unknown' + identifiable → full_board + warning", async () => {
    const r = await review({
      study_design: "retrospective_chart_review",
      intervention: "x",
      indication: "y",
      data_handling: "pseudonymized",
      risk_level: "unknown",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).toMatch(/risk_level.*unknown/i);
  });

  it("registry + risk_level='unknown' + identifiable → full_board + warning", async () => {
    const r = await review({
      study_design: "registry",
      intervention: "x",
      indication: "y",
      data_handling: "pseudonymized",
      risk_level: "unknown",
      funding_source: "industry",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).toMatch(/risk_level.*unknown.*registry/i);
  });

  it("non_interventional_prospective + risk_level='unknown' → full_board + warning", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "x",
      indication: "y",
      data_handling: "pseudonymized",
      risk_level: "unknown",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).toMatch(/risk_level.*unknown.*non-interventional/i);
  });

  it("benign_behavioural=true + study_design='non_interventional_prospective' → contradictory-input warning", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "x",
      indication: "y",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      benign_behavioural: true,
    });
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).toMatch(
      /benign_behavioural.*requires.*study_design.*interventional/i,
    );
  });

  it("marketed_drug=true + risk_level='greater_than_minimal' → silent-drop warning", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "x",
      indication: "y",
      data_handling: "pseudonymized",
      risk_level: "greater_than_minimal",
      funding_source: "industry",
      jurisdictions: ["us_irb"],
      marketed_drug: true,
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).toMatch(
      /marketed_drug.*greater_than_minimal|expedited cat 1 requires minimal/i,
    );
  });

  it("interventional + benign_behavioural + minimal → icf_complexity_tier='basic' (was 'standard' pre-fix)", async () => {
    const r = await review({
      study_design: "interventional",
      intervention: "5-min breathing exercise",
      indication: "stress",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
      benign_behavioural: true,
    });
    expect(r.irb_assessment.icf_complexity_tier).toBe("basic");
  });

  it("questionnaire_only + identifiable → cat 7 + advisory about §46.104(d)(2) second prong", async () => {
    const r = await review({
      study_design: "questionnaire_only",
      intervention: "patient interviews",
      indication: "treatment burden",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    const warnings = r.irb_assessment.advisory_warnings.join(" ");
    expect(warnings).toMatch(
      /§46\.104\(d\)\(2\).*second prong|disclosure of responses/i,
    );
  });
});

describe("irb_review — v1.5.1 untested-branch coverage", () => {
  it("retrospective_chart_review + greater_than_minimal + pseudonymized → full_board", async () => {
    const r = await review({
      ...MINIMAL_RETROSPECTIVE,
      data_handling: "pseudonymized",
      risk_level: "greater_than_minimal",
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
  });

  it("registry + minimal + pseudonymized → expedited cat 5", async () => {
    const r = await review({
      study_design: "registry",
      intervention: "oncology patient registry",
      indication: "lung cancer",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toContain(5);
  });

  it("registry + greater_than_minimal + identifiable → full_board", async () => {
    const r = await review({
      study_design: "registry",
      intervention: "oncology patient registry",
      indication: "lung cancer",
      data_handling: "pseudonymized",
      risk_level: "greater_than_minimal",
      funding_source: "industry",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
  });

  it("non_interventional_prospective + no hint flags + minimal → expedited cat 4 (default-fallthrough path)", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "real-world outcomes study",
      indication: "rheumatoid arthritis",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("expedited");
    expect(r.irb_assessment.expedited_categories_us).toEqual([4]);
  });

  it("hint precedence: marketed_drug + noninvasive_collection both true → cat 1 wins", async () => {
    const r = await review({
      study_design: "non_interventional_prospective",
      intervention: "post-marketing saliva biomarker study",
      indication: "T2D",
      data_handling: "pseudonymized",
      risk_level: "minimal",
      funding_source: "industry",
      jurisdictions: ["us_irb"],
      marketed_drug: true,
      noninvasive_collection: true,
    });
    expect(r.irb_assessment.expedited_categories_us).toContain(1);
    expect(r.irb_assessment.expedited_categories_us).not.toContain(3);
  });

  it("secondary_data_analysis + fully_identifiable + no broad_consent → full_board", async () => {
    const r = await review({
      study_design: "secondary_data_analysis",
      intervention: "EHR linkage",
      indication: "CKD outcomes",
      data_handling: "fully_identifiable",
      risk_level: "minimal",
      funding_source: "nih",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
  });

  it("specimen_repository + fully_identifiable + no broad_consent → full_board", async () => {
    const r = await review({
      study_design: "specimen_repository",
      intervention: "tissue bank for future studies",
      indication: "colorectal cancer",
      data_handling: "fully_identifiable",
      risk_level: "minimal",
      funding_source: "academic",
      jurisdictions: ["us_irb"],
    });
    expect(r.irb_assessment.review_tier_us).toBe("full_board");
  });
});
