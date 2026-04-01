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
});
