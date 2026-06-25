/**
 * Tests for confounder_expert_template (evidence.confounder_expert_template).
 * Design log #43 — Pufulete Step 2/3 clinician-interview instrument.
 *
 * Pure & deterministic: no network, no LLM. Turns a list of "unmeasurable"
 * confounders (e.g. confounder_identification.expert_interview_required) into a
 * ready-to-paste interview guide + structured survey items.
 */

import { handleConfounderExpertTemplate } from "../../src/tools/confounderExpertTemplate.js";

type Content = {
  markdown_checklist: string;
  survey_items: Array<{
    confounder: string;
    association_with_treatment_q: string;
    association_with_outcome_q: string;
    measurable_in_rwd_q: string;
    proxy_q: string;
    likert_scale: string[];
  }>;
  dag_elicitation_prompts: string[];
};

const BASE = {
  intervention: "dimethyl fumarate",
  comparator: "glatiramer acetate",
  indication: "relapsing-remitting multiple sclerosis",
};

describe("handleConfounderExpertTemplate", () => {
  it("requires intervention/comparator/indication", async () => {
    await expect(handleConfounderExpertTemplate({ intervention: "x" })).rejects.toThrow();
  });

  it("tags the audit evidence.confounder_expert_template", async () => {
    const r = await handleConfounderExpertTemplate(BASE);
    expect(r.audit.tool).toBe("evidence.confounder_expert_template");
  });

  it("builds one survey item per supplied unmeasurable confounder", async () => {
    const r = await handleConfounderExpertTemplate({
      ...BASE,
      unmeasurable_confounders: ["Patient treatment preference", "Tolerability expectation"],
    });
    const c = r.content as Content;
    expect(c.survey_items).toHaveLength(2);
    expect(c.survey_items[0].confounder).toBe("Patient treatment preference");
    expect(c.survey_items[0].likert_scale.length).toBeGreaterThan(0);
    // each item poses the two confounding-criterion questions
    expect(c.survey_items[0].association_with_treatment_q.toLowerCase()).toContain("treatment");
    expect(c.survey_items[0].association_with_outcome_q.toLowerCase()).toContain("outcome");
  });

  it("falls back to a default confounder set when none supplied", async () => {
    const r = await handleConfounderExpertTemplate(BASE);
    const c = r.content as Content;
    expect(c.survey_items.length).toBeGreaterThanOrEqual(1);
    expect(c.dag_elicitation_prompts.length).toBeGreaterThan(0);
  });

  it("renders the intervention and comparator into the checklist", async () => {
    const r = await handleConfounderExpertTemplate(BASE);
    const c = r.content as Content;
    expect(c.markdown_checklist).toContain("dimethyl fumarate");
    expect(c.markdown_checklist).toContain("glatiramer acetate");
  });
});
