/**
 * Shared utilities for building Markov params from CEModelParams
 * and computing ICERs.
 */

import type { CEModelParams } from "../providers/types.js";
import type { MarkovParams, MarkovState, TransitionMatrix } from "./markov.js";
import { runMarkovModel } from "./markov.js";

const DISCOUNT_RATE = 0.035;

export function getTimeHorizonYears(
  horizon: CEModelParams["time_horizon"],
): number {
  if (horizon === "lifetime") return 40;
  if (horizon === "5yr") return 5;
  if (horizon === "10yr") return 10;
  return Number(horizon);
}

/**
 * Build MarkovParams from CEModelParams using a 3-state model
 * (On-Treatment, Off-Treatment, Dead).
 *
 * The Dead state is an absorbing state (utility=0, cost=0) — the cohort
 * fraction that enters Dead never leaves, which correctly bounds life-year
 * and QALY accumulation over the time horizon.
 */
export function buildMarkovParamsFromCE(params: CEModelParams): MarkovParams {
  const years = getTimeHorizonYears(params.time_horizon);
  const cycle_length_years = 1;
  const n_cycles = years;

  // Utility values
  const utilityOn = params.utility_inputs?.qaly_on_treatment ?? 0.75;
  const utilityOff = params.utility_inputs?.qaly_comparator ?? 0.7;

  // Costs
  const costIntervention =
    params.cost_inputs.drug_cost_annual + (params.cost_inputs.admin_cost ?? 0);
  const costComparator =
    params.cost_inputs.comparator_cost_annual +
    (params.cost_inputs.admin_cost ?? 0);

  // Efficacy delta used to derive annual probability of staying on treatment
  const efficacyDelta = Math.max(
    0,
    Math.min(0.999, params.clinical_inputs.efficacy_delta),
  );
  const mortalityReduction = params.clinical_inputs.mortality_reduction ?? 0;

  // Background annual mortality rate (~2% baseline, reduced by mortalityReduction)
  const baseMortality = 0.02;
  const interventionMortality = Math.max(
    0.005,
    baseMortality * (1 - mortalityReduction),
  );
  const comparatorMortality = baseMortality;

  // Transition: prob of staying in On-Treatment state
  const probStayOnIntervention = Math.max(
    0.05,
    Math.min(0.93, 0.5 + efficacyDelta * 0.5),
  );
  const baselineProbStayOn = Math.max(
    0.05,
    Math.min(0.88, probStayOnIntervention * 0.7),
  );

  const states: MarkovState[] = [
    { name: "On-Treatment", utility: utilityOn, cost_annual: costIntervention },
    { name: "Off-Treatment", utility: utilityOff, cost_annual: 0 },
    { name: "Dead", utility: 0, cost_annual: 0 },
  ];

  // Helper: ensure row sums to 1.0
  function normalizeRow(row: Record<string, number>): Record<string, number> {
    const sum = Object.values(row).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) < 1e-10) return row;
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(row)) {
      result[k] = v / sum;
    }
    return result;
  }

  const transition_matrix_intervention: TransitionMatrix = {
    "On-Treatment": normalizeRow({
      "On-Treatment": probStayOnIntervention,
      "Off-Treatment": 1 - probStayOnIntervention - interventionMortality,
      Dead: interventionMortality,
    }),
    "Off-Treatment": normalizeRow({
      "On-Treatment": 0.05,
      "Off-Treatment": 0.95 - interventionMortality,
      Dead: interventionMortality,
    }),
    Dead: { "On-Treatment": 0, "Off-Treatment": 0, Dead: 1 },
  };

  const transition_matrix_comparator: TransitionMatrix = {
    "On-Treatment": normalizeRow({
      "On-Treatment": baselineProbStayOn,
      "Off-Treatment": 1 - baselineProbStayOn - comparatorMortality,
      Dead: comparatorMortality,
    }),
    "Off-Treatment": normalizeRow({
      "On-Treatment": 0.05,
      "Off-Treatment": 0.95 - comparatorMortality,
      Dead: comparatorMortality,
    }),
    Dead: { "On-Treatment": 0, "Off-Treatment": 0, Dead: 1 },
  };

  return {
    states,
    transition_matrix_intervention,
    transition_matrix_comparator,
    initial_cohort: { "On-Treatment": 1.0, "Off-Treatment": 0.0, Dead: 0.0 },
    cycle_length_years,
    n_cycles,
    discount_rate_costs: DISCOUNT_RATE,
    discount_rate_outcomes: DISCOUNT_RATE,
  };
}

/**
 * Run Markov model from CEModelParams and return delta_cost, delta_qaly, ICER.
 *
 * Runs the model twice — once with intervention state costs and once with
 * comparator state costs — so each arm uses the correct drug cost.
 */
export function runMarkovAndComputeICER(params: CEModelParams): {
  delta_cost: number;
  delta_qaly: number;
  icer: number;
  intervention_cost: number;
  comparator_cost: number;
  intervention_qaly: number;
  comparator_qaly: number;
  intervention_lys: number;
  comparator_lys: number;
} {
  const baseParams = buildMarkovParamsFromCE(params);

  // Utility values (shared across arms)
  const utilityOn = params.utility_inputs?.qaly_on_treatment ?? 0.75;
  const utilityOff = params.utility_inputs?.qaly_comparator ?? 0.7;

  // Costs per arm
  const costIntervention =
    params.cost_inputs.drug_cost_annual + (params.cost_inputs.admin_cost ?? 0);
  const costComparator =
    params.cost_inputs.comparator_cost_annual +
    (params.cost_inputs.admin_cost ?? 0);

  const statesIntervention: MarkovState[] = [
    { name: "On-Treatment", utility: utilityOn, cost_annual: costIntervention },
    { name: "Off-Treatment", utility: utilityOff, cost_annual: 0 },
    { name: "Dead", utility: 0, cost_annual: 0 },
  ];

  const statesComparator: MarkovState[] = [
    { name: "On-Treatment", utility: utilityOn, cost_annual: costComparator },
    { name: "Off-Treatment", utility: utilityOff, cost_annual: 0 },
    { name: "Dead", utility: 0, cost_annual: 0 },
  ];

  // Run intervention arm: use intervention states + intervention transition matrix.
  // We pass intervention states in both arms' params; we only use the intervention
  // arm result from this call.
  const interventionRun = runMarkovModel({
    ...baseParams,
    states: statesIntervention,
  });

  // Run comparator arm: use comparator states + comparator transition matrix.
  // We only use the comparator arm result from this call.
  const comparatorRun = runMarkovModel({
    ...baseParams,
    states: statesComparator,
  });

  const intervention = interventionRun.intervention;
  const comparator = comparatorRun.comparator;

  const delta_cost = intervention.total_cost - comparator.total_cost;
  const delta_qaly = intervention.total_qaly - comparator.total_qaly;
  const icer =
    delta_qaly > 0
      ? delta_cost / delta_qaly
      : delta_qaly < 0
        ? -Infinity
        : Infinity;

  return {
    delta_cost,
    delta_qaly,
    icer,
    intervention_cost: intervention.total_cost,
    comparator_cost: comparator.total_cost,
    intervention_qaly: intervention.total_qaly,
    comparator_qaly: comparator.total_qaly,
    intervention_lys: intervention.total_lys,
    comparator_lys: comparator.total_lys,
  };
}
