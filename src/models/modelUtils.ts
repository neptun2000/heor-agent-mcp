/**
 * Shared utilities for building Markov params from CEModelParams
 * and computing ICERs.
 */

import type { CEModelParams } from "../providers/types.js";
import type { MarkovParams, MarkovState, TransitionMatrix } from "./markov.js";
import { runMarkovModel } from "./markov.js";

const DISCOUNT_RATE = 0.035;

function getTimeHorizonYears(horizon: CEModelParams["time_horizon"]): number {
  if (horizon === "lifetime") return 40;
  if (horizon === "5yr") return 5;
  if (horizon === "10yr") return 10;
  return Number(horizon);
}

/**
 * Build MarkovParams from CEModelParams using a 2-state model
 * (On-Treatment, Off-Treatment).
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
  // Higher efficacy → more cycles on treatment → better health
  const efficacyDelta = Math.max(
    0,
    Math.min(0.999, params.clinical_inputs.efficacy_delta),
  );
  const mortalityReduction = params.clinical_inputs.mortality_reduction ?? 0;

  // Transition: prob of staying in On-Treatment state for intervention
  // Base: driven by efficacy (0.4 efficacy → ~0.8 prob of staying on treatment, modulated)
  const probStayOnIntervention = Math.max(
    0.05,
    Math.min(0.95, 0.5 + efficacyDelta * 0.5),
  );
  // For comparator: lower stay probability (baseline)
  const baselineProbStayOn = Math.max(
    0.05,
    Math.min(0.9, probStayOnIntervention * 0.7),
  );

  // Mortality reduction affects off-treatment → death transition
  // (simplified: mortality reduction lowers probability of going to off-treatment)
  const mortalityEffect = Math.max(0, Math.min(0.3, mortalityReduction * 0.3));

  const states: MarkovState[] = [
    { name: "On-Treatment", utility: utilityOn, cost_annual: costIntervention },
    { name: "Off-Treatment", utility: utilityOff, cost_annual: 0 },
  ];

  const statesComparator: MarkovState[] = [
    { name: "On-Treatment", utility: utilityOn, cost_annual: costComparator },
    { name: "Off-Treatment", utility: utilityOff, cost_annual: 0 },
  ];

  const transition_matrix_intervention: TransitionMatrix = {
    "On-Treatment": {
      "On-Treatment": Math.min(0.95, probStayOnIntervention + mortalityEffect),
      "Off-Treatment": Math.max(
        0.05,
        1 - probStayOnIntervention - mortalityEffect,
      ),
    },
    "Off-Treatment": {
      "On-Treatment": 0.05,
      "Off-Treatment": 0.95,
    },
  };

  const transition_matrix_comparator: TransitionMatrix = {
    "On-Treatment": {
      "On-Treatment": Math.min(0.9, baselineProbStayOn),
      "Off-Treatment": Math.max(0.1, 1 - baselineProbStayOn),
    },
    "Off-Treatment": {
      "On-Treatment": 0.05,
      "Off-Treatment": 0.95,
    },
  };

  return {
    states,
    transition_matrix_intervention,
    transition_matrix_comparator,
    initial_cohort: { "On-Treatment": 1.0, "Off-Treatment": 0.0 },
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
  ];

  const statesComparator: MarkovState[] = [
    { name: "On-Treatment", utility: utilityOn, cost_annual: costComparator },
    { name: "Off-Treatment", utility: utilityOff, cost_annual: 0 },
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
