import { runMarkovModel } from "../../src/models/markov.js";
import type { MarkovParams } from "../../src/models/markov.js";

function buildSimple2StateParams(overrides: Partial<MarkovParams> = {}): MarkovParams {
  return {
    states: [
      { name: "Healthy", utility: 0.8, cost_annual: 1000 },
      { name: "Sick", utility: 0.5, cost_annual: 5000 },
    ],
    transition_matrix_intervention: {
      Healthy: { Healthy: 0.9, Sick: 0.1 },
      Sick: { Healthy: 0.2, Sick: 0.8 },
    },
    transition_matrix_comparator: {
      Healthy: { Healthy: 0.8, Sick: 0.2 },
      Sick: { Healthy: 0.1, Sick: 0.9 },
    },
    initial_cohort: { Healthy: 1.0, Sick: 0.0 },
    cycle_length_years: 1,
    n_cycles: 10,
    discount_rate_costs: 0.035,
    discount_rate_outcomes: 0.035,
    ...overrides,
  };
}

describe("runMarkovModel", () => {
  it("intervention arm has higher QALYs when it has better transitions", () => {
    const params = buildSimple2StateParams();
    const { intervention, comparator } = runMarkovModel(params);
    // Intervention keeps more people healthy → more QALYs
    expect(intervention.total_qaly).toBeGreaterThan(comparator.total_qaly);
  });

  it("state trace sums to approximately 1.0 at each cycle", () => {
    const params = buildSimple2StateParams();
    const { intervention } = runMarkovModel(params);
    for (const entry of intervention.state_trace) {
      const sum = Object.values(entry.distribution).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 6);
    }
  });

  it("state trace has n_cycles + 1 entries (cycle 0 through n_cycles)", () => {
    const params = buildSimple2StateParams({ n_cycles: 5 });
    const { intervention } = runMarkovModel(params);
    expect(intervention.state_trace.length).toBe(6);
  });

  it("Dead state is absorbing when included", () => {
    const paramsWithDead: MarkovParams = {
      states: [
        { name: "Alive", utility: 1.0, cost_annual: 1000 },
        { name: "Dead", utility: 0.0, cost_annual: 0 },
      ],
      transition_matrix_intervention: {
        Alive: { Alive: 0.9, Dead: 0.1 },
        Dead: { Alive: 0.0, Dead: 1.0 },  // absorbing
      },
      transition_matrix_comparator: {
        Alive: { Alive: 0.85, Dead: 0.15 },
        Dead: { Alive: 0.0, Dead: 1.0 },
      },
      initial_cohort: { Alive: 1.0, Dead: 0.0 },
      cycle_length_years: 1,
      n_cycles: 10,
      discount_rate_costs: 0.035,
      discount_rate_outcomes: 0.035,
    };

    const { intervention } = runMarkovModel(paramsWithDead);

    // Dead state proportion should increase monotonically
    let prevDeadProp = 0;
    for (const entry of intervention.state_trace) {
      const deadProp = entry.distribution["Dead"] ?? 0;
      expect(deadProp).toBeGreaterThanOrEqual(prevDeadProp - 1e-10);
      prevDeadProp = deadProp;
    }

    // All proportions still sum to 1
    for (const entry of intervention.state_trace) {
      const sum = Object.values(entry.distribution).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 6);
    }
  });

  it("produces positive total costs and QALYs", () => {
    const params = buildSimple2StateParams();
    const { intervention, comparator } = runMarkovModel(params);
    expect(intervention.total_cost).toBeGreaterThan(0);
    expect(intervention.total_qaly).toBeGreaterThan(0);
    expect(comparator.total_cost).toBeGreaterThan(0);
    expect(comparator.total_qaly).toBeGreaterThan(0);
  });

  it("discounting reduces long-horizon values compared to zero discount", () => {
    const paramsDiscounted = buildSimple2StateParams({ n_cycles: 20 });
    const paramsNoDiscount = buildSimple2StateParams({
      n_cycles: 20,
      discount_rate_costs: 0,
      discount_rate_outcomes: 0,
    });
    const { intervention: d } = runMarkovModel(paramsDiscounted);
    const { intervention: nd } = runMarkovModel(paramsNoDiscount);
    expect(d.total_cost).toBeLessThan(nd.total_cost);
    expect(d.total_qaly).toBeLessThan(nd.total_qaly);
  });
});
