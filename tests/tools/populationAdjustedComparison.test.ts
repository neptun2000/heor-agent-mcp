import { handlePopulationAdjustedComparison } from "../../src/tools/populationAdjustedComparison.js";

describe("handlePopulationAdjustedComparison", () => {
  const baseParams = {
    index_trial: {
      name: "TrialA",
      treatment: "DrugA",
      comparator: "Placebo",
      n: 300,
      effect: 0.74,
      ci_lower: 0.58,
      ci_upper: 0.95,
      measure: "HR" as const,
      covariates: [
        { name: "age", mean: 56, sd: 10 },
        { name: "bmi", mean: 33, sd: 5 },
      ],
    },
    target_trial: {
      name: "TrialB",
      treatment: "DrugB",
      comparator: "Placebo",
      n: 600,
      effect: 0.78,
      ci_lower: 0.65,
      ci_upper: 0.93,
      measure: "HR" as const,
      covariates: [
        { name: "age", mean: 58, sd: 9 },
        { name: "bmi", mean: 35, sd: 6 },
      ],
    },
    effect_modifiers: ["age", "bmi"],
  };

  it("runs happy path and returns text content", async () => {
    const result = await handlePopulationAdjustedComparison(baseParams);
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("Population-Adjusted Indirect Comparison");
  });

  it("rejects missing required fields", async () => {
    await expect(
      handlePopulationAdjustedComparison({ effect_modifiers: ["age"] }),
    ).rejects.toThrow();
  });

  it("auto-selects MAIC when covariates >= 2 and n >= 50", async () => {
    const result = await handlePopulationAdjustedComparison({
      ...baseParams,
      output_format: "json",
      method: "auto",
    });
    const content = result.content as { method: string };
    expect(content.method).toBe("maic");
  });

  it("auto-selects STC with fewer covariates", async () => {
    const result = await handlePopulationAdjustedComparison({
      ...baseParams,
      index_trial: {
        ...baseParams.index_trial,
        covariates: [{ name: "age", mean: 56, sd: 10 }],
      },
      target_trial: {
        ...baseParams.target_trial,
        covariates: [{ name: "age", mean: 58, sd: 9 }],
      },
      effect_modifiers: ["age"],
      output_format: "json",
      method: "auto",
    });
    const content = result.content as { method: string };
    expect(content.method).toBe("stc");
  });

  it("returns ESS less than original N for MAIC", async () => {
    const result = await handlePopulationAdjustedComparison({
      ...baseParams,
      method: "maic",
      output_format: "json",
    });
    const content = result.content as { ess: number; original_n: number };
    expect(content.ess).toBeLessThanOrEqual(content.original_n);
    expect(content.ess).toBeGreaterThan(0);
  });

  it("includes experimental warning in audit", async () => {
    const result = await handlePopulationAdjustedComparison(baseParams);
    const warnings = result.audit.warnings?.join(" ") ?? "";
    expect(warnings.toLowerCase()).toContain("experimental");
  });
});
