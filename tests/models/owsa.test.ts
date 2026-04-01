import { runOWSA, buildDefaultOWSAParameters } from "../../src/models/owsa.js";
import { runMarkovAndComputeICER } from "../../src/models/modelUtils.js";
import type { CEModelParams } from "../../src/providers/types.js";

const baseParams: CEModelParams = {
  intervention: "Drug A",
  comparator: "Drug B",
  indication: "Test",
  time_horizon: "10yr",
  perspective: "us_payer",
  clinical_inputs: { efficacy_delta: 0.4 },
  cost_inputs: { drug_cost_annual: 10000, comparator_cost_annual: 5000 },
  utility_inputs: { qaly_on_treatment: 0.78, qaly_comparator: 0.7 },
};

describe("runOWSA", () => {
  it("returns results sorted by impact descending", () => {
    const parameters = buildDefaultOWSAParameters(baseParams);
    const results = runOWSA(baseParams, parameters, (p) =>
      runMarkovAndComputeICER(p),
    );
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.impact).toBeLessThanOrEqual(results[i - 1]!.impact);
    }
  });

  it("at least one parameter produces different low and high ICERs", () => {
    const parameters = buildDefaultOWSAParameters(baseParams);
    const results = runOWSA(baseParams, parameters, (p) =>
      runMarkovAndComputeICER(p),
    );
    const hasDifferingIcers = results.some(
      (r) =>
        isFinite(r.icer_low) &&
        isFinite(r.icer_high) &&
        r.icer_low !== r.icer_high,
    );
    expect(hasDifferingIcers).toBe(true);
  });

  it("returns one result per parameter", () => {
    const parameters = buildDefaultOWSAParameters(baseParams);
    const results = runOWSA(baseParams, parameters, (p) =>
      runMarkovAndComputeICER(p),
    );
    expect(results.length).toBe(parameters.length);
  });

  it("impact equals abs(icer_high - icer_low) for finite values", () => {
    const parameters = buildDefaultOWSAParameters(baseParams);
    const results = runOWSA(baseParams, parameters, (p) =>
      runMarkovAndComputeICER(p),
    );
    for (const result of results) {
      if (isFinite(result.icer_low) && isFinite(result.icer_high)) {
        expect(result.impact).toBeCloseTo(
          Math.abs(result.icer_high - result.icer_low),
          6,
        );
      }
    }
  });

  it("buildDefaultOWSAParameters includes key parameters", () => {
    const params = buildDefaultOWSAParameters(baseParams);
    const names = params.map((p) => p.name);
    expect(names).toContain("drug_cost_annual");
    expect(names).toContain("comparator_cost_annual");
    expect(names).toContain("efficacy_delta");
    expect(names).toContain("qaly_on_treatment");
    expect(names).toContain("qaly_comparator");
  });

  it("low_value is less than base_value", () => {
    const params = buildDefaultOWSAParameters(baseParams);
    for (const p of params) {
      expect(p.low_value).toBeLessThan(p.base_value);
    }
  });

  it("high_value is greater than base_value", () => {
    const params = buildDefaultOWSAParameters(baseParams);
    for (const p of params) {
      expect(p.high_value).toBeGreaterThan(p.base_value);
    }
  });
});
