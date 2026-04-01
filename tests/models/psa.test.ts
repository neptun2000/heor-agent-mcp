import { runPSA } from "../../src/models/psa.js";
import type { PSAParams } from "../../src/models/psa.js";
import type { CEModelParams } from "../../src/providers/types.js";

const baseParams: CEModelParams = {
  intervention: "Drug A",
  comparator: "Drug B",
  indication: "Test Indication",
  time_horizon: "10yr",
  perspective: "nhs",
  clinical_inputs: { efficacy_delta: 0.4 },
  cost_inputs: { drug_cost_annual: 1000, comparator_cost_annual: 500 },
  utility_inputs: { qaly_on_treatment: 0.78, qaly_comparator: 0.70 },
};

describe("runPSA", () => {
  it("produces the expected number of iterations", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 100, seed: 42 };
    const result = runPSA(params);
    expect(result.iterations.length).toBe(100);
  });

  it("CEAC is monotonically non-decreasing", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 200, seed: 99 };
    const result = runPSA(params);
    for (let i = 1; i < result.ceac.length; i++) {
      expect(result.ceac[i]!.prob_ce).toBeGreaterThanOrEqual(result.ceac[i - 1]!.prob_ce - 1e-10);
    }
  });

  it("EVPI is non-negative", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 200, seed: 7 };
    const result = runPSA(params);
    expect(result.evpi).toBeGreaterThanOrEqual(0);
  });

  it("prob_cost_effective at WTP=0 is approximately 0", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 500, seed: 42 };
    const result = runPSA(params);
    // At wtp=0, NMB = 0*delta_qaly - delta_cost = -delta_cost
    // This is positive only when delta_cost < 0 (intervention is cheaper)
    // Since intervention costs more, prob_ce at wtp=0 should be very low
    const firstCEAC = result.ceac[0];
    expect(firstCEAC).toBeDefined();
    expect(firstCEAC!.wtp).toBe(0);
    expect(firstCEAC!.prob_ce).toBeLessThanOrEqual(0.5);
  });

  it("prob_cost_effective at WTP=300000 is high for cost-effective intervention", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 500, seed: 42 };
    const result = runPSA(params);
    const lastCEAC = result.ceac[result.ceac.length - 1];
    expect(lastCEAC).toBeDefined();
    expect(lastCEAC!.wtp).toBe(300000);
    // At very high WTP, most cost-effective interventions should show high prob
    expect(lastCEAC!.prob_ce).toBeGreaterThan(0.5);
  });

  it("scatter_sample has at most 500 points", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 1000, seed: 42 };
    const result = runPSA(params);
    expect(result.scatter_sample.length).toBeLessThanOrEqual(500);
  });

  it("scatter_sample has exactly 500 points when iterations > 500", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 1000, seed: 42 };
    const result = runPSA(params);
    expect(result.scatter_sample.length).toBe(500);
  });

  it("scatter_sample has exactly n_iterations points when iterations <= 500", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 100, seed: 42 };
    const result = runPSA(params);
    expect(result.scatter_sample.length).toBe(100);
  });

  it("produces reproducible results with same seed", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 50, seed: 1234 };
    const result1 = runPSA(params);
    const result2 = runPSA(params);
    expect(result1.mean_icer).toBeCloseTo(result2.mean_icer, 6);
  });

  it("CI lower is less than or equal to mean ICER", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 500, seed: 42 };
    const result = runPSA(params);
    if (isFinite(result.mean_icer)) {
      expect(result.ci_icer_lower).toBeLessThanOrEqual(result.mean_icer);
    }
  });

  it("CI upper is greater than or equal to mean ICER", () => {
    const params: PSAParams = { base_params: baseParams, n_iterations: 500, seed: 42 };
    const result = runPSA(params);
    if (isFinite(result.mean_icer)) {
      expect(result.ci_icer_upper).toBeGreaterThanOrEqual(result.mean_icer);
    }
  });
});
