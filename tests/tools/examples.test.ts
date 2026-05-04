/**
 * Tests for the examples tool — returns canonical pre-filled inputs for the
 * heavy economic tools so users (Claude/ChatGPT/etc.) can demo them in one
 * prompt instead of typing 50 lines of JSON from scratch.
 *
 * PostHog showed cost_effectiveness_model, budget_impact_model,
 * survival_fitting, and population_adjusted_comparison had ZERO real-world
 * calls despite strong overall traffic — the input schema is too heavy for
 * users to invent on the fly.
 */

import { handleExamples } from "../../src/tools/examples.js";

describe("handleExamples — pre-filled inputs for heavy economic tools", () => {
  it("returns CEA example for cost_effectiveness_model", async () => {
    const r = await handleExamples({ tool: "cost_effectiveness_model" });
    const txt =
      typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    expect(txt).toMatch(/cost_effectiveness_model/);
    expect(txt).toMatch(/intervention/);
    expect(txt).toMatch(/comparator/);
    expect(txt).toMatch(/indication/);
    expect(txt).toMatch(/perspective/);
    expect(txt).toMatch(/clinical_inputs|efficacy_delta/);
    expect(txt).toMatch(/cost_inputs|drug_cost_annual/);
  });

  it("returns BIA example for budget_impact_model", async () => {
    const r = await handleExamples({ tool: "budget_impact_model" });
    const txt =
      typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    expect(txt).toMatch(/budget_impact_model/);
    expect(txt).toMatch(/eligible_population|uptake/);
    expect(txt).toMatch(/time_horizon|years/);
  });

  it("returns survival example for survival_fitting", async () => {
    const r = await handleExamples({ tool: "survival_fitting" });
    const txt =
      typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    expect(txt).toMatch(/survival_fitting/);
    expect(txt).toMatch(/km_data|time|survival_prob|n_at_risk/i);
  });

  it("returns MAIC/STC example for population_adjusted_comparison", async () => {
    const r = await handleExamples({ tool: "population_adjusted_comparison" });
    const txt =
      typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    expect(txt).toMatch(/population_adjusted_comparison|MAIC|STC/i);
  });

  it("returns Bucher example for evidence_indirect", async () => {
    const r = await handleExamples({ tool: "evidence_indirect" });
    const txt =
      typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    expect(txt).toMatch(/evidence_indirect|Bucher|comparisons/i);
  });

  it("output includes a runnable JSON code fence", async () => {
    const r = await handleExamples({ tool: "cost_effectiveness_model" });
    const txt = String(r.content);
    expect(txt).toMatch(/```json[\s\S]*?```/);
  });

  it("listing all examples when no tool given", async () => {
    const r = await handleExamples({});
    const txt = String(r.content);
    expect(txt).toMatch(/cost_effectiveness_model/);
    expect(txt).toMatch(/budget_impact_model/);
    expect(txt).toMatch(/survival_fitting/);
    expect(txt).toMatch(/population_adjusted_comparison/);
    expect(txt).toMatch(/evidence_indirect/);
  });

  it("rejects unknown tool with a helpful error", async () => {
    await expect(handleExamples({ tool: "nonexistent_tool" })).rejects.toThrow(
      /unknown|not found|invalid/i,
    );
  });

  it("CEA example uses NICE-reasonable values (NHS perspective, sane costs)", async () => {
    const r = await handleExamples({ tool: "cost_effectiveness_model" });
    const txt = String(r.content);
    // The example should be NHS perspective (most teaching-friendly) with
    // realistic semaglutide-vs-sitagliptin numbers
    expect(txt).toMatch(/nhs|NHS/i);
  });

  it("BIA example uses round, copy-friendly numbers", async () => {
    const r = await handleExamples({ tool: "budget_impact_model" });
    const txt = String(r.content);
    // Population 50000, 5-year horizon, simple uptake curve
    expect(txt).toMatch(/50000|10000|100000/);
  });

  // 2026-05-04: ChatGPT GPT can't reliably chain 5+ literature_search
  // calls in parallel for a full MAIC pipeline (tool-agency limitation).
  // The maic_workflow_recipe entry returns a multi-step prompt the user
  // can copy-paste, OR a recommendation to use the web UI / Claude
  // Desktop where Claude's tool agency handles the chain natively.
  describe("maic_workflow_recipe", () => {
    it("returns a step-by-step prompt for ChatGPT users", async () => {
      const r = await handleExamples({ tool: "maic_workflow_recipe" });
      const txt = String(r.content);
      expect(txt).toMatch(/maic|matching-adjusted/i);
      expect(txt).toMatch(/literature_search/);
      expect(txt).toMatch(/parallel|step/i);
    });

    it("recommends Claude web UI for full pipeline depth", async () => {
      const r = await handleExamples({ tool: "maic_workflow_recipe" });
      const txt = String(r.content);
      expect(txt).toMatch(
        /web-michael-ns-projects\.vercel\.app|web UI|Claude/i,
      );
    });

    it("includes trial-name search suggestions", async () => {
      const r = await handleExamples({ tool: "maic_workflow_recipe" });
      const txt = String(r.content);
      expect(txt).toMatch(/QUASAR|INSPIRE|U-ACHIEVE|trial name/i);
    });
  });

  it("listing all examples includes maic_workflow_recipe", async () => {
    const r = await handleExamples({});
    const txt = String(r.content);
    expect(txt).toMatch(/maic_workflow_recipe/);
  });
});
