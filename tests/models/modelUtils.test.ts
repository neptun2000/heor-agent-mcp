/**
 * Tests for modelUtils.ts — structural assumption disclosure and computation helpers.
 */

import {
  MARKOV_STRUCTURAL_ASSUMPTIONS,
  getTimeHorizonYears,
  buildMarkovParamsFromCE,
} from "../../src/models/modelUtils.js";
import type { CEModelParams } from "../../src/providers/types.js";

// Minimal valid CEModelParams fixture
const BASE_PARAMS: CEModelParams = {
  intervention: "DrugA",
  comparator: "Placebo",
  indication: "Test indication",
  time_horizon: "10yr",
  perspective: "nhs",
  clinical_inputs: { efficacy_delta: 0.4 },
  cost_inputs: {
    drug_cost_annual: 10000,
    comparator_cost_annual: 1000,
  },
};

// ---------------------------------------------------------------------------
// MARKOV_STRUCTURAL_ASSUMPTIONS disclosure constant
// ---------------------------------------------------------------------------

describe("MARKOV_STRUCTURAL_ASSUMPTIONS", () => {
  it("exports exactly 3 assumption strings", () => {
    expect(MARKOV_STRUCTURAL_ASSUMPTIONS).toHaveLength(3);
  });

  it("discloses the 2% background mortality assumption", () => {
    const mortalityAssumption = MARKOV_STRUCTURAL_ASSUMPTIONS.find((s) =>
      s.includes("2%"),
    );
    expect(mortalityAssumption).toBeDefined();
    expect(mortalityAssumption).toMatch(/background annual mortality/i);
    expect(mortalityAssumption).toMatch(/0\.02/);
    expect(mortalityAssumption).toMatch(/STRUCTURAL ASSUMPTION/);
    expect(mortalityAssumption).toMatch(/illustrative/i);
  });

  it("discloses the efficacy_delta→transition-probability heuristic", () => {
    const formulaAssumption = MARKOV_STRUCTURAL_ASSUMPTIONS.find((s) =>
      s.includes("efficacy_delta"),
    );
    expect(formulaAssumption).toBeDefined();
    expect(formulaAssumption).toMatch(/0\.5 \+ efficacy_delta/);
    expect(formulaAssumption).toMatch(/heuristic/i);
    expect(formulaAssumption).toMatch(/no epidemiological basis/i);
    expect(formulaAssumption).toMatch(/STRUCTURAL ASSUMPTION/);
  });

  it("discloses the 0.7× comparator-retention scalar", () => {
    const comparatorAssumption = MARKOV_STRUCTURAL_ASSUMPTIONS.find((s) =>
      s.includes("0.7"),
    );
    expect(comparatorAssumption).toBeDefined();
    expect(comparatorAssumption).toMatch(/comparator retention/i);
    expect(comparatorAssumption).toMatch(/70%/);
    expect(comparatorAssumption).toMatch(/arbitrary/i);
    expect(comparatorAssumption).toMatch(/STRUCTURAL ASSUMPTION/);
  });

  it("all assumptions warn against submission use", () => {
    for (const assumption of MARKOV_STRUCTURAL_ASSUMPTIONS) {
      expect(assumption).toMatch(/submission/i);
    }
  });

  it("is a readonly array (frozen at the type level)", () => {
    // Runtime check: the array reference is exported as `readonly`, but we
    // can verify it behaves like a plain array with the right values.
    expect(Array.isArray(MARKOV_STRUCTURAL_ASSUMPTIONS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTimeHorizonYears
// ---------------------------------------------------------------------------

describe("getTimeHorizonYears", () => {
  it("returns 40 for 'lifetime'", () => {
    expect(getTimeHorizonYears("lifetime")).toBe(40);
  });

  it("returns 5 for '5yr'", () => {
    expect(getTimeHorizonYears("5yr")).toBe(5);
  });

  it("returns 10 for '10yr'", () => {
    expect(getTimeHorizonYears("10yr")).toBe(10);
  });

  it("returns the numeric value for a number input", () => {
    expect(getTimeHorizonYears(20)).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// buildMarkovParamsFromCE — structural assumption values match disclosures
// ---------------------------------------------------------------------------

describe("buildMarkovParamsFromCE structural values", () => {
  it("uses 2% background mortality for comparator Dead transition", () => {
    const mp = buildMarkovParamsFromCE(BASE_PARAMS);
    // Comparator On-Treatment → Dead should equal 0.02 (no mortality reduction)
    const deadProb =
      mp.transition_matrix_comparator["On-Treatment"]["Dead"];
    expect(deadProb).toBeCloseTo(0.02, 5);
  });

  it("derives probStayOnIntervention via 0.5 + delta*0.5 formula", () => {
    // efficacy_delta=0.4 → raw = 0.5 + 0.4*0.5 = 0.70 (within [0.05, 0.93])
    const mp = buildMarkovParamsFromCE(BASE_PARAMS);
    const stayProb = mp.transition_matrix_intervention["On-Treatment"]["On-Treatment"];
    expect(stayProb).toBeCloseTo(0.7, 4);
  });

  it("sets comparator retention to 70% of intervention retention", () => {
    // probStayOnIntervention=0.70 → baselineProbStayOn=0.70*0.7=0.49 (within [0.05, 0.88])
    const mp = buildMarkovParamsFromCE(BASE_PARAMS);
    const interventionStay =
      mp.transition_matrix_intervention["On-Treatment"]["On-Treatment"];
    const comparatorStay =
      mp.transition_matrix_comparator["On-Treatment"]["On-Treatment"];
    expect(comparatorStay).toBeCloseTo(interventionStay * 0.7, 4);
  });
});
