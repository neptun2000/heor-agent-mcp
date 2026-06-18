/**
 * Tests for rwe_method_select — RWE study-design selection.
 *
 * Ranks the five core RWE methodologies (retrospective database analysis,
 * survey, literature review, chart review, social-media listening) against
 * a research objective, data availability, decision context, and required
 * rigour. Pure decision logic, no I/O.
 */
import {
  handleRweMethodSelect,
  type RweMethodSelection,
} from "../../src/tools/rweMethodSelect.js";

interface RweResult {
  content: string;
  rwe_method_selection: RweMethodSelection;
}

async function select(input: Record<string, unknown>): Promise<RweResult> {
  return (await handleRweMethodSelect(input)) as unknown as RweResult;
}

// ---- Schema validation ---------------------------------------------------

describe("rwe_method_select — schema validation", () => {
  it("requires research_objective", async () => {
    await expect(handleRweMethodSelect({})).rejects.toThrow(
      /required|research_objective/i,
    );
  });

  it("accepts the minimal valid input (defaults applied)", async () => {
    const r = await select({ research_objective: "treatment_effectiveness" });
    expect(r.rwe_method_selection.primary).not.toBeNull();
  });

  it("rejects an unknown research_objective with did-you-mean", async () => {
    await expect(
      select({ research_objective: "effectiveness_of_treatment" as never }),
    ).rejects.toThrow(/treatment_effectiveness|research_objective/i);
  });

  it("rejects an unknown data source with did-you-mean", async () => {
    await expect(
      select({
        research_objective: "safety_surveillance",
        available_data: ["claims"] as never,
      }),
    ).rejects.toThrow(/claims_database|available_data/i);
  });

  it("is case-insensitive on enums", async () => {
    const r = await select({
      research_objective: "Treatment_Effectiveness",
      decision_context: "HTA_PAYER",
      rigor_required: "Submission_Grade",
      available_data: ["EHR"],
    });
    expect(r.rwe_method_selection.primary?.method).toBe(
      "retrospective_database_analysis",
    );
  });
});

// ---- Core recommendations ------------------------------------------------

describe("rwe_method_select — primary recommendations", () => {
  it("submission-grade effectiveness with a claims DB → retrospective database analysis", async () => {
    const r = await select({
      research_objective: "treatment_effectiveness",
      available_data: ["claims_database"],
      decision_context: "hta_payer",
      rigor_required: "submission_grade",
    });
    expect(r.rwe_method_selection.primary?.method).toBe(
      "retrospective_database_analysis",
    );
  });

  it("evidence synthesis with published literature → literature review", async () => {
    const r = await select({
      research_objective: "evidence_synthesis",
      available_data: ["published_literature"],
      decision_context: "clinical_guideline",
      rigor_required: "submission_grade",
    });
    expect(r.rwe_method_selection.primary?.method).toBe("literature_review");
  });

  it("patient preferences via survey access → survey", async () => {
    const r = await select({
      research_objective: "patient_preferences",
      available_data: ["patient_survey_access"],
      decision_context: "internal_strategy",
      rigor_required: "supportive",
    });
    expect(r.rwe_method_selection.primary?.method).toBe("survey");
  });

  it("patient experience / sentiment, exploratory, with social media → social media listening", async () => {
    const r = await select({
      research_objective: "patient_experience",
      available_data: ["social_media"],
      decision_context: "exploratory",
      rigor_required: "exploratory",
    });
    expect(r.rwe_method_selection.primary?.method).toBe(
      "social_media_listening",
    );
  });

  it("treatment patterns from patient charts → chart review", async () => {
    const r = await select({
      research_objective: "treatment_patterns",
      available_data: ["patient_charts"],
      decision_context: "internal_strategy",
      rigor_required: "supportive",
    });
    expect(r.rwe_method_selection.primary?.method).toBe("chart_review");
  });
});

// ---- Feasibility gating --------------------------------------------------

describe("rwe_method_select — feasibility", () => {
  it("excludes methods whose required data is not available", async () => {
    const r = await select({
      research_objective: "treatment_effectiveness",
      available_data: ["claims_database"],
      rigor_required: "supportive",
    });
    const infeasibleMethods = r.rwe_method_selection.infeasible.map(
      (m) => m.method,
    );
    // Only claims/EHR available → survey, chart review, lit review, social all infeasible
    expect(infeasibleMethods).toContain("survey");
    expect(infeasibleMethods).toContain("chart_review");
    expect(infeasibleMethods).toContain("literature_review");
    expect(infeasibleMethods).toContain("social_media_listening");
    expect(r.rwe_method_selection.primary?.method).toBe(
      "retrospective_database_analysis",
    );
  });

  it("warns (does not crash) when no data makes any method feasible", async () => {
    const r = await select({
      research_objective: "treatment_effectiveness",
      available_data: ["social_media"], // wrong data for an effectiveness DB study
      rigor_required: "submission_grade",
    });
    // social_media_listening is still feasible (it's the only data we have),
    // but it cannot meet submission_grade rigour.
    expect(r.rwe_method_selection.primary?.method).toBe(
      "social_media_listening",
    );
    expect(r.rwe_method_selection.rigor_satisfiable).toBe(false);
    expect(r.rwe_method_selection.advisory_warnings.join(" ")).toMatch(
      /rigour|validity|supportive/i,
    );
  });

  it("when no available_data declared, all methods stay candidates with a feasibility caveat", async () => {
    const r = await select({
      research_objective: "treatment_effectiveness",
      rigor_required: "supportive",
    });
    expect(r.rwe_method_selection.infeasible).toHaveLength(0);
    expect(r.rwe_method_selection.primary?.caveats.join(" ")).toMatch(
      /feasibility unconfirmed|requires access/i,
    );
  });
});

// ---- Rigour / validity logic --------------------------------------------

describe("rwe_method_select — rigour alignment", () => {
  it("flags rigor_satisfiable=false when only a low-validity design is feasible at submission grade", async () => {
    const r = await select({
      research_objective: "patient_experience",
      available_data: ["social_media"],
      rigor_required: "submission_grade",
    });
    expect(r.rwe_method_selection.rigor_satisfiable).toBe(false);
  });

  it("rigor_satisfiable=true when a high-validity feasible design exists", async () => {
    const r = await select({
      research_objective: "treatment_effectiveness",
      available_data: ["ehr"],
      rigor_required: "submission_grade",
    });
    expect(r.rwe_method_selection.rigor_satisfiable).toBe(true);
  });

  it("every recommendation carries the design's intrinsic validity note as a caveat", async () => {
    const r = await select({
      research_objective: "treatment_effectiveness",
      available_data: ["claims_database"],
    });
    expect(r.rwe_method_selection.primary?.caveats.length).toBeGreaterThan(0);
  });
});

// ---- Tool routing / output ----------------------------------------------

describe("rwe_method_select — tool routing and output", () => {
  it("primary recommendation links to downstream tools that operationalise it", async () => {
    const r = await select({
      research_objective: "evidence_synthesis",
      available_data: ["published_literature"],
    });
    expect(r.rwe_method_selection.primary?.pairs_with_tools).toContain(
      "literature.search",
    );
  });

  it("markdown names the recommended method, validity, and a comparison matrix", async () => {
    const r = await select({
      research_objective: "treatment_effectiveness",
      available_data: ["claims_database"],
      decision_context: "hta_payer",
      rigor_required: "submission_grade",
    });
    const t = r.content;
    expect(t).toMatch(/Recommended method/i);
    expect(t).toMatch(/Retrospective Database Analysis/);
    expect(t).toMatch(/Method comparison matrix/i);
    expect(t).toMatch(/Results validity/i);
  });

  it("suggests triangulation when a strong alternative exists", async () => {
    const r = await select({
      research_objective: "safety_surveillance",
      // both DB analysis and chart review serve safety; both feasible
      available_data: ["claims_database", "patient_charts"],
      rigor_required: "supportive",
    });
    expect(r.rwe_method_selection.advisory_warnings.join(" ")).toMatch(
      /triangulat/i,
    );
  });
});

// ---- Performance ---------------------------------------------------------

describe("rwe_method_select — performance", () => {
  it("returns in under 200ms (pure decision logic)", async () => {
    const start = Date.now();
    await select({ research_objective: "treatment_effectiveness" });
    expect(Date.now() - start).toBeLessThan(200);
  });
});
