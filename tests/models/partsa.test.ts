import { runPartSA } from "../../src/models/partsa.js";
import type { PartSAParams } from "../../src/models/partsa.js";

function buildBaseParams(overrides: Partial<PartSAParams> = {}): PartSAParams {
  return {
    intervention_survival: {
      os_median_months: 24,
      pfs_median_months: 12,
      distribution: "exponential",
    },
    comparator_survival: {
      os_median_months: 18,
      pfs_median_months: 9,
      distribution: "exponential",
    },
    states: ["PFS", "PD", "Dead"],
    utility_pfs: 0.75,
    utility_pd: 0.55,
    cost_pfs_annual: 50000,
    cost_pd_annual: 20000,
    n_cycles: 10,
    cycle_length_years: 1,
    discount_rate_costs: 0.035,
    discount_rate_outcomes: 0.035,
    ...overrides,
  };
}

describe("runPartSA", () => {
  it("returns positive total_cost and total_qaly for both arms", () => {
    const result = runPartSA(buildBaseParams());

    expect(result.intervention.total_cost).toBeGreaterThan(0);
    expect(result.intervention.total_qaly).toBeGreaterThan(0);
    expect(result.comparator.total_cost).toBeGreaterThan(0);
    expect(result.comparator.total_qaly).toBeGreaterThan(0);
  });

  it("longer OS median produces higher total QALYs", () => {
    const shortOS = runPartSA(buildBaseParams({
      intervention_survival: {
        os_median_months: 12,
        pfs_median_months: 6,
        distribution: "exponential",
      },
    }));

    const longOS = runPartSA(buildBaseParams({
      intervention_survival: {
        os_median_months: 48,
        pfs_median_months: 6,
        distribution: "exponential",
      },
    }));

    expect(longOS.intervention.total_qaly).toBeGreaterThan(shortOS.intervention.total_qaly);
  });

  it("intervention with better PFS has higher total_qaly than comparator with worse PFS", () => {
    const result = runPartSA(buildBaseParams({
      intervention_survival: {
        os_median_months: 24,
        pfs_median_months: 18,  // better PFS for intervention
        distribution: "exponential",
      },
      comparator_survival: {
        os_median_months: 24,
        pfs_median_months: 6,   // worse PFS for comparator
        distribution: "exponential",
      },
    }));

    expect(result.intervention.total_qaly).toBeGreaterThan(result.comparator.total_qaly);
  });
});
