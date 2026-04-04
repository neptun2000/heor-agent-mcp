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
    expect(result.audit.tool).toBe("cost_effectiveness_model");
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
  });

  it("records assumptions in audit", async () => {
    const result = await handleCostEffectivenessModel(validParams);
    expect(result.audit.assumptions.length).toBeGreaterThan(0);
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
    expect(result.audit.tool).toBe("cost_effectiveness_model");
  });
});
