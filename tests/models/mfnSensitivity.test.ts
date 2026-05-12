/**
 * Behavioural tests for the MFN price-sensitivity sweep (design log #27).
 *
 * Uses a synthetic deterministic `runModel` callback so tests don't depend
 * on the full Markov implementation. ICER is parameterised as a linear
 * function of drug_price: `icer = A + B * drug_price`. With B > 0 we can
 * pick A and B so the curve crosses any target WTP at a known price,
 * which is exactly what the crossover tests need.
 */
import {
  runMfnSensitivity,
  type CEModelInputs,
  type MfnSensitivityInputs,
} from "../../src/models/mfnSensitivity.js";

const minimalBase: CEModelInputs = {
  time_horizon_years: 5,
  discount_rate: 0.035,
  cost_inputs: {
    drug_cost_annual: 200,
    comparator_cost_annual: 50,
    admin_cost: 0,
    ae_cost: 0,
  },
  clinical_inputs: {
    efficacy_delta: 0.05,
    mortality_reduction: 0.01,
  },
} as unknown as CEModelInputs;

/**
 * Linear ICER = A + B * drug_price. With A=0, B=500 the ICER at price=200
 * is 100000 (US WTP) and at price=95 is 47500. Excellent for crossover
 * tests targeting $100K and $150K.
 */
function makeLinearRunner(A: number, B: number) {
  return (params: CEModelInputs) => ({
    icer: A + B * params.cost_inputs.drug_cost_annual,
  });
}

describe("runMfnSensitivity — basic curve shape", () => {
  it("produces n_points evenly spaced from min_basket to current_us_price", () => {
    const result = runMfnSensitivity(
      minimalBase,
      { min_basket: 100, current_us_price: 200, n_points: 11 },
      makeLinearRunner(0, 500),
    );
    expect(result.curve).toHaveLength(11);
    expect(result.curve[0]?.drug_price).toBe(100);
    expect(result.curve[10]?.drug_price).toBe(200);
    // Step = 10
    expect(result.curve[5]?.drug_price).toBeCloseTo(150, 6);
  });

  it("defaults to 11 points when n_points is omitted", () => {
    const result = runMfnSensitivity(
      minimalBase,
      { min_basket: 100, current_us_price: 200 },
      makeLinearRunner(0, 500),
    );
    expect(result.curve).toHaveLength(11);
  });

  it("computes ICER at every price (using injected runner)", () => {
    const result = runMfnSensitivity(
      minimalBase,
      { min_basket: 100, current_us_price: 200, n_points: 3 },
      makeLinearRunner(0, 500),
    );
    expect(result.curve.map((p) => p.icer)).toEqual([50000, 75000, 100000]);
  });

  it("icer_at_ceiling and icer_at_current echo first / last curve points", () => {
    const result = runMfnSensitivity(
      minimalBase,
      { min_basket: 100, current_us_price: 200, n_points: 5 },
      makeLinearRunner(0, 500),
    );
    expect(result.icer_at_ceiling).toBe(result.curve[0]?.icer);
    expect(result.icer_at_current).toBe(result.curve[4]?.icer);
  });
});

describe("runMfnSensitivity — crossover detection", () => {
  it("locates the price at which ICER crosses a WTP threshold (linear interpolation)", () => {
    // ICER = 500 * price. WTP 100000 → crossover at price = 200.
    // WTP 50000 → price = 100.
    const result = runMfnSensitivity(
      minimalBase,
      {
        min_basket: 50,
        current_us_price: 250,
        n_points: 11,
        wtp_thresholds: [50000, 100000, 150000],
      },
      makeLinearRunner(0, 500),
    );
    const findX = (wtp: number) =>
      result.crossovers.find((c) => c.wtp === wtp)?.crossover_price;
    expect(findX(50000)).toBeCloseTo(100, 1);
    expect(findX(100000)).toBeCloseTo(200, 1);
    expect(findX(150000)).toBeNull(); // 500 * 250 = 125000 — never reaches 150K in range
  });

  it("returns null when ICER stays below WTP across the entire sweep (cost-effective everywhere)", () => {
    // ICER = 100 * price. Range 100..200 → ICER 10K..20K. WTP 100K never crossed.
    const result = runMfnSensitivity(
      minimalBase,
      {
        min_basket: 100,
        current_us_price: 200,
        wtp_thresholds: [100000],
      },
      makeLinearRunner(0, 100),
    );
    expect(result.crossovers[0]?.crossover_price).toBeNull();
  });

  it("returns null when ICER stays above WTP across the entire sweep (never cost-effective)", () => {
    // ICER = 1000 * price. Range 100..200 → ICER 100K..200K. WTP 50K never reached.
    const result = runMfnSensitivity(
      minimalBase,
      {
        min_basket: 100,
        current_us_price: 200,
        wtp_thresholds: [50000],
      },
      makeLinearRunner(0, 1000),
    );
    expect(result.crossovers[0]?.crossover_price).toBeNull();
  });

  it("defaults to {30K, 100K, 150K} WTP set when wtp_thresholds omitted", () => {
    const result = runMfnSensitivity(
      minimalBase,
      { min_basket: 100, current_us_price: 200 },
      makeLinearRunner(0, 500),
    );
    const wtps = result.crossovers.map((c) => c.wtp).sort((a, b) => a - b);
    expect(wtps).toEqual([30000, 100000, 150000]);
  });
});

describe("runMfnSensitivity — input validation", () => {
  it("rejects non-finite min_basket", () => {
    expect(() =>
      runMfnSensitivity(
        minimalBase,
        { min_basket: NaN, current_us_price: 200 },
        makeLinearRunner(0, 500),
      ),
    ).toThrow(TypeError);
  });

  it("rejects negative current_us_price", () => {
    expect(() =>
      runMfnSensitivity(
        minimalBase,
        { min_basket: 100, current_us_price: -10 },
        makeLinearRunner(0, 500),
      ),
    ).toThrow(TypeError);
  });

  it("rejects min_basket > current_us_price (would invert the sweep)", () => {
    expect(() =>
      runMfnSensitivity(
        minimalBase,
        { min_basket: 200, current_us_price: 100 },
        makeLinearRunner(0, 500),
      ),
    ).toThrow(TypeError);
  });

  it("clamps n_points to ≥2 so the sweep always has at least two endpoints", () => {
    const result = runMfnSensitivity(
      minimalBase,
      { min_basket: 100, current_us_price: 200, n_points: 1 },
      makeLinearRunner(0, 500),
    );
    expect(result.curve.length).toBeGreaterThanOrEqual(2);
  });
});

describe("runMfnSensitivity — degenerate ICER handling", () => {
  it("Infinity ICER values do not trigger spurious crossovers", () => {
    // Some price points return Infinity (e.g. negative delta_QALY).
    // The crossover finder should skip those segments.
    const runner = (params: CEModelInputs) => {
      // Above price=150, return Infinity. Below, return 50000 (linear with a kink).
      if (params.cost_inputs.drug_cost_annual >= 150) {
        return { icer: Infinity };
      }
      return { icer: 50000 };
    };
    const result = runMfnSensitivity(
      minimalBase,
      {
        min_basket: 100,
        current_us_price: 200,
        n_points: 11,
        wtp_thresholds: [100000],
      },
      runner,
    );
    // No crossover should be detected — ICER is below 100K on the finite
    // half and Infinity on the other; never crosses cleanly.
    expect(result.crossovers[0]?.crossover_price).toBeNull();
  });
});
