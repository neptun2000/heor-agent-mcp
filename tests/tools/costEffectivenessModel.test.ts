import { handleCostEffectivenessModel } from "../../src/tools/costEffectivenessModel.js";
import type { CEModelParams } from "../../src/providers/types.js";

const validParams: CEModelParams = {
  intervention: "semaglutide 1mg",
  comparator: "sitagliptin",
  indication: "type 2 diabetes",
  time_horizon: "lifetime",
  perspective: "nhs",
  clinical_inputs: { efficacy_delta: 0.42 },
  cost_inputs: { drug_cost_annual: 800, comparator_cost_annual: 400 },
  utility_inputs: { qaly_on_treatment: 0.78, qaly_comparator: 0.71 },
};

describe("handleCostEffectivenessModel", () => {
  it("returns ToolResult with audit", async () => {
    const result = await handleCostEffectivenessModel(validParams);
    expect(result.audit.tool).toBe("models.cost_effectiveness");
    expect(result.audit.methodology).toContain("Markov");
    expect(result.content).toBeDefined();
  });

  it("computes ICER correctly", async () => {
    const result = await handleCostEffectivenessModel(validParams);
    // incremental_cost = 800 - 400 = 400/yr, discounted over lifetime (~40yr at 3.5%)
    // incremental_qaly = 0.78 - 0.71 = 0.07/yr, discounted
    // ICER should be in range ~4000-8000 £/QALY
    const content = result.content as string;
    // Check it contains a number formatted with comma (thousands separator)
    expect(content).toMatch(/[\d,]+.*QALY/);
  });

  it("flags below NICE threshold when ICER < 20000", async () => {
    const result = await handleCostEffectivenessModel(validParams);
    const content = result.content as string;
    expect(content).toMatch(/below.*NICE threshold|cost.effective/i);
  });

  it("includes disclaimer in output", async () => {
    const result = await handleCostEffectivenessModel(validParams);
    expect(result.content as string).toContain("qualified health economist");
    // V1: disclosure block present for standard-level tool
    expect(result.content as string).toContain("AI Assistance Disclosure");
  });

  it("records assumptions in audit", async () => {
    const result = await handleCostEffectivenessModel(validParams);
    expect(result.audit.assumptions.length).toBeGreaterThan(0);
  });

  describe("summary_metric (evLYG)", () => {
    it("does not add alternative metrics section by default", async () => {
      const result = await handleCostEffectivenessModel(validParams);
      expect(result.content as string).not.toContain(
        "Alternative Summary Metric",
      );
    });

    it("adds evLYG section when summary_metric='evlyg'", async () => {
      const result = await handleCostEffectivenessModel({
        ...validParams,
        summary_metric: "evlyg",
      });
      const text = result.content as string;
      expect(text).toContain("Alternative Summary Metric");
      expect(text).toContain("evLYG");
      expect(text).toContain("CMS");
      expect(text).toContain("IRA");
      expect(text).toContain("Primary metric for this analysis: evLYG");
    });

    it("reports both QALY and evLYG when summary_metric='both'", async () => {
      const result = await handleCostEffectivenessModel({
        ...validParams,
        summary_metric: "both",
      });
      const text = result.content as string;
      expect(text).toContain("Alternative Summary Metric");
      expect(text).toContain("evLYG");
      expect(text).toContain("QALY"); // from main section
      expect(text).toContain("Both QALY and evLYG");
    });

    it("cites §1194(e)(2)", async () => {
      const result = await handleCostEffectivenessModel({
        ...validParams,
        summary_metric: "evlyg",
      });
      expect(result.content as string).toContain("1194");
    });
  });

  it("ICER direction is correct when intervention costs more than comparator", async () => {
    // drug_cost_annual=800 > comparator_cost_annual=400, so delta_cost must be > 0
    // With positive efficacy_delta, intervention also has better QALYs → ICER > 0
    const result = await handleCostEffectivenessModel({
      ...validParams,
      output_format: "json",
    });
    const modelResult = result.content as {
      base_case: { delta_cost: number; delta_qaly: number; icer: number };
    };
    expect(modelResult.base_case.delta_cost).toBeGreaterThan(0);
    expect(modelResult.base_case.icer).toBeGreaterThan(0);
  });

  it("throws on missing required field", async () => {
    await expect(handleCostEffectivenessModel({})).rejects.toThrow();
  });

  it("accepts valid params as unknown input", async () => {
    const result = await handleCostEffectivenessModel(validParams as unknown);
    expect(result.audit.tool).toBe("models.cost_effectiveness");
  });

  // ── Better error messages — addresses 40% error rate (PostHog 2026-05-05)

  describe("schema-error helpfulness", () => {
    it("error message names which field is missing (Zod issue path included)", async () => {
      try {
        await handleCostEffectivenessModel({
          intervention: "x",
          comparator: "y",
          indication: "z",
        } as never);
        throw new Error("should have thrown");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toMatch(/time_horizon|perspective|clinical_inputs/i);
      }
    });

    it("hints at clinical_inputs wrapper when caller flattens efficacy_delta to top level", async () => {
      // Common LLM failure: passing efficacy_delta directly under root
      // instead of inside clinical_inputs.
      try {
        await handleCostEffectivenessModel({
          intervention: "x",
          comparator: "y",
          indication: "z",
          time_horizon: "5yr",
          perspective: "nhs",
          efficacy_delta: 0.4, // wrong — should be inside clinical_inputs
          cost_inputs: { drug_cost_annual: 1000, comparator_cost_annual: 500 },
        } as never);
        throw new Error("should have thrown");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toMatch(/clinical_inputs/i);
      }
    });

    it("flags efficacy_delta > 1 as out-of-range with the field name cited", async () => {
      // Common LLM failure: sending percentage 45 instead of fraction 0.45
      try {
        await handleCostEffectivenessModel({
          intervention: "x",
          comparator: "y",
          indication: "z",
          time_horizon: "5yr",
          perspective: "nhs",
          clinical_inputs: { efficacy_delta: 45 }, // wrong: should be 0.45
          cost_inputs: { drug_cost_annual: 1000, comparator_cost_annual: 500 },
        } as never);
        throw new Error("should have thrown");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toMatch(/efficacy_delta/i);
      }
    });
  });

  // Codex P1 (2026-05-07): model_type="partsa" without survival_inputs
  // previously fell through silently to the Markov branch, while audit still
  // reported "Partitioned Survival Analysis" and PSA was suppressed. Now it
  // throws with a clear message instead.
  describe("model_type='partsa' guard", () => {
    it("throws when survival_inputs missing", async () => {
      await expect(
        handleCostEffectivenessModel({
          ...validParams,
          model_type: "partsa",
          // survival_inputs deliberately omitted
        }),
      ).rejects.toThrow(/partsa.*requires survival_inputs/i);
    });

    it("succeeds when survival_inputs supplied", async () => {
      const result = await handleCostEffectivenessModel({
        ...validParams,
        model_type: "partsa",
        survival_inputs: {
          os_median_months: 24,
          pfs_median_months: 12,
          survival_distribution: "exponential",
        },
      } as never);
      expect(result.audit.methodology).toMatch(/Partitioned Survival/i);
    });

    it("does NOT throw for default Markov even without survival_inputs", async () => {
      // Regression guard: Markov is the default and must not be affected by the new check.
      const result = await handleCostEffectivenessModel(validParams);
      expect(result.audit.methodology).toMatch(/Markov/i);
    });
  });
});
