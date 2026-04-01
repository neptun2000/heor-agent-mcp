/**
 * Multi-state Markov cohort model with half-cycle correction and discounting.
 */

export interface MarkovState {
  name: string;
  utility: number;      // QALY weight for this state
  cost_annual: number;  // Annual cost in this state
}

export interface TransitionMatrix {
  // transition_matrix[from][to] = probability per cycle
  [fromState: string]: { [toState: string]: number };
}

export interface MarkovParams {
  states: MarkovState[];
  transition_matrix_intervention: TransitionMatrix;
  transition_matrix_comparator: TransitionMatrix;
  initial_cohort: { [stateName: string]: number }; // must sum to 1
  cycle_length_years: number;
  n_cycles: number;
  discount_rate_costs: number;
  discount_rate_outcomes: number;
}

export interface MarkovRunResult {
  total_cost: number;
  total_qaly: number;
  total_lys: number;    // life years survived
  state_trace: Array<{ cycle: number; distribution: Record<string, number> }>;
}

/**
 * Run one arm of a Markov cohort simulation.
 * Uses half-cycle correction: add half a cycle's value at cycle 0 and final cycle.
 */
function runArm(
  params: MarkovParams,
  transitionMatrix: TransitionMatrix
): MarkovRunResult {
  const { states, initial_cohort, cycle_length_years, n_cycles, discount_rate_costs, discount_rate_outcomes } = params;
  const stateNames = states.map(s => s.name);

  // Initialize cohort distribution
  let cohort: Record<string, number> = {};
  for (const name of stateNames) {
    cohort[name] = initial_cohort[name] ?? 0;
  }

  let total_cost = 0;
  let total_qaly = 0;
  let total_lys = 0;

  const state_trace: Array<{ cycle: number; distribution: Record<string, number> }> = [];

  // Half-cycle correction at cycle 0 (t=0)
  const discountCost0 = 1 / Math.pow(1 + discount_rate_costs, 0);
  const discountOutcome0 = 1 / Math.pow(1 + discount_rate_outcomes, 0);

  for (const state of states) {
    const prop = cohort[state.name] ?? 0;
    // Half cycle at start
    total_cost += prop * state.cost_annual * cycle_length_years * 0.5 * discountCost0;
    total_qaly += prop * state.utility * cycle_length_years * 0.5 * discountOutcome0;
    // Life years: any non-dead state contributes (assume "Dead" states have utility ~0 — but we track LYs by cohort alive)
    if (state.utility > 0) {
      total_lys += prop * cycle_length_years * 0.5 * discountOutcome0;
    }
  }

  state_trace.push({ cycle: 0, distribution: { ...cohort } });

  for (let cycle = 1; cycle <= n_cycles; cycle++) {
    // Apply transition matrix: new cohort
    const newCohort: Record<string, number> = {};
    for (const name of stateNames) {
      newCohort[name] = 0;
    }

    for (const fromName of stateNames) {
      const fromProp = cohort[fromName] ?? 0;
      if (fromProp <= 0) continue;

      const row = transitionMatrix[fromName];
      if (!row) {
        // No transitions defined: stay in same state
        newCohort[fromName] = (newCohort[fromName] ?? 0) + fromProp;
        continue;
      }

      for (const toName of stateNames) {
        const prob = row[toName] ?? 0;
        newCohort[toName] = (newCohort[toName] ?? 0) + fromProp * prob;
      }
    }

    cohort = newCohort;

    // Discount factors (time t = cycle in years from start)
    const t = cycle * cycle_length_years;
    const discountCost = 1 / Math.pow(1 + discount_rate_costs, t);
    const discountOutcome = 1 / Math.pow(1 + discount_rate_outcomes, t);

    const isLastCycle = cycle === n_cycles;
    const cycleFraction = isLastCycle ? 0.5 : 1.0; // half-cycle at last cycle

    for (const state of states) {
      const prop = cohort[state.name] ?? 0;
      total_cost += prop * state.cost_annual * cycle_length_years * cycleFraction * discountCost;
      total_qaly += prop * state.utility * cycle_length_years * cycleFraction * discountOutcome;
      if (state.utility > 0) {
        total_lys += prop * cycle_length_years * cycleFraction * discountOutcome;
      }
    }

    state_trace.push({ cycle, distribution: { ...cohort } });
  }

  return { total_cost, total_qaly, total_lys, state_trace };
}

/**
 * Run Markov model for both intervention and comparator arms.
 */
export function runMarkovModel(
  params: MarkovParams
): { intervention: MarkovRunResult; comparator: MarkovRunResult } {
  const intervention = runArm(params, params.transition_matrix_intervention);
  const comparator = runArm(params, params.transition_matrix_comparator);
  return { intervention, comparator };
}
