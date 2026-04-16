import { handleBudgetImpactModel } from "../../src/tools/budgetImpactModel.js";

describe("handleBudgetImpactModel", () => {
  const baseParams = {
    intervention: "TestDrug",
    comparator: "SoC",
    indication: "Type 2 Diabetes",
    perspective: "nhs",
    time_horizon_years: 5,
    eligible_population: 10000,
    market_share: { year_1: 0.1 },
    drug_cost_annual: 1000,
    comparator_cost_annual: 200,
  };

  it("runs happy path and returns text content", async () => {
    const result = await handleBudgetImpactModel(baseParams);
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("Budget Impact Analysis");
    expect(result.content).toContain("Year");
  });

  it("rejects missing required fields", async () => {
    await expect(
      handleBudgetImpactModel({ intervention: "X" }),
    ).rejects.toThrow();
  });

  it("returns JSON structure when output_format=json", async () => {
    const result = await handleBudgetImpactModel({
      ...baseParams,
      output_format: "json",
    });
    const content = result.content as {
      years: Array<{ year: number; net_budget_impact: number }>;
      total_net_budget_impact: number;
      total_patients_treated: number;
    };
    expect(content.years).toHaveLength(5);
    expect(typeof content.total_net_budget_impact).toBe("number");
    expect(typeof content.total_patients_treated).toBe("number");
  });

  it("forward-fills missing market share years correctly", async () => {
    // year_1 = 0.1, years 2-5 missing → should all be 0.1, NOT jump to something else
    const result = await handleBudgetImpactModel({
      ...baseParams,
      market_share: { year_1: 0.1 },
      output_format: "json",
    });
    const content = result.content as {
      years: Array<{ year: number; treated_population: number }>;
    };
    // Year 1 and Year 5 should have similar treated populations (same market share)
    const y1 = content.years[0]!.treated_population;
    const y5 = content.years[4]!.treated_population;
    expect(y1).toBeGreaterThan(900);
    expect(y1).toBeLessThan(1100);
    expect(y5).toBeCloseTo(y1, -2); // Within 100 patients (population growth is 0)
  });

  it("ramps market share when multiple years specified", async () => {
    const result = await handleBudgetImpactModel({
      ...baseParams,
      market_share: { year_1: 0.05, year_5: 0.4 },
      output_format: "json",
    });
    const content = result.content as {
      years: Array<{ year: number; treated_population: number }>;
    };
    // Year 1 treated should be much less than year 5 treated
    expect(content.years[0]!.treated_population).toBeLessThan(
      content.years[4]!.treated_population,
    );
  });

  it("handles populationn growth", async () => {
    const result = await handleBudgetImpactModel({
      ...baseParams,
      population_growth_rate: 0.05,
      output_format: "json",
    });
    const content = result.content as {
      years: Array<{ year: number; eligible_population: number }>;
    };
    expect(content.years[4]!.eligible_population).toBeGreaterThan(
      content.years[0]!.eligible_population,
    );
  });
});
