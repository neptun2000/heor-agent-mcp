/**
 * One-Way Sensitivity Analysis (OWSA) for tornado diagram generation.
 */

import type { CEModelParams } from "../providers/types.js";

export type CEModelInputs = CEModelParams;

export interface OWSAParameter {
  name: string;
  base_value: number;
  low_value: number;   // default: base * 0.8
  high_value: number;  // default: base * 1.2
}

export interface OWSAResult {
  parameter: string;
  low_value: number;
  high_value: number;
  icer_low: number;
  icer_high: number;
  impact: number;  // abs(icer_high - icer_low)
}

/**
 * Run OWSA: vary each parameter one at a time and compute ICER.
 * Returns results sorted by impact descending (tornado diagram order).
 */
export function runOWSA(
  baseParams: CEModelInputs,
  parameters: OWSAParameter[],
  runModel: (params: CEModelInputs) => { icer: number }
): OWSAResult[] {
  const results: OWSAResult[] = [];

  for (const param of parameters) {
    const icer_low = runModel(applyParameter(baseParams, param.name, param.low_value)).icer;
    const icer_high = runModel(applyParameter(baseParams, param.name, param.high_value)).icer;

    const safe_icer_low = isFinite(icer_low) ? icer_low : 999999;
    const safe_icer_high = isFinite(icer_high) ? icer_high : 999999;

    results.push({
      parameter: param.name,
      low_value: param.low_value,
      high_value: param.high_value,
      icer_low,
      icer_high,
      impact: Math.abs(safe_icer_high - safe_icer_low),
    });
  }

  // Sort by impact descending (tornado diagram order)
  return results.sort((a, b) => b.impact - a.impact);
}

/**
 * Apply a parameter value to CEModelParams by name.
 * Supports dot-notation for nested params.
 */
function applyParameter(params: CEModelInputs, name: string, value: number): CEModelInputs {
  switch (name) {
    case "drug_cost_annual":
      return { ...params, cost_inputs: { ...params.cost_inputs, drug_cost_annual: value } };
    case "comparator_cost_annual":
      return { ...params, cost_inputs: { ...params.cost_inputs, comparator_cost_annual: value } };
    case "admin_cost":
      return { ...params, cost_inputs: { ...params.cost_inputs, admin_cost: value } };
    case "ae_cost":
      return { ...params, cost_inputs: { ...params.cost_inputs, ae_cost: value } };
    case "efficacy_delta":
      return { ...params, clinical_inputs: { ...params.clinical_inputs, efficacy_delta: value } };
    case "mortality_reduction":
      return { ...params, clinical_inputs: { ...params.clinical_inputs, mortality_reduction: value } };
    case "qaly_on_treatment":
      return {
        ...params,
        utility_inputs: params.utility_inputs
          ? { ...params.utility_inputs, qaly_on_treatment: value }
          : { qaly_on_treatment: value, qaly_comparator: 0.7 },
      };
    case "qaly_comparator":
      return {
        ...params,
        utility_inputs: params.utility_inputs
          ? { ...params.utility_inputs, qaly_comparator: value }
          : { qaly_on_treatment: 0.75, qaly_comparator: value },
      };
    default:
      return params;
  }
}

/**
 * Build default OWSA parameters from CEModelParams with ±20% variation.
 */
export function buildDefaultOWSAParameters(params: CEModelInputs): OWSAParameter[] {
  const parameters: OWSAParameter[] = [
    {
      name: "drug_cost_annual",
      base_value: params.cost_inputs.drug_cost_annual,
      low_value: params.cost_inputs.drug_cost_annual * 0.8,
      high_value: params.cost_inputs.drug_cost_annual * 1.2,
    },
    {
      name: "comparator_cost_annual",
      base_value: params.cost_inputs.comparator_cost_annual,
      low_value: params.cost_inputs.comparator_cost_annual * 0.8,
      high_value: params.cost_inputs.comparator_cost_annual * 1.2,
    },
    {
      name: "efficacy_delta",
      base_value: params.clinical_inputs.efficacy_delta,
      low_value: Math.max(0.001, params.clinical_inputs.efficacy_delta * 0.8),
      high_value: Math.min(0.999, params.clinical_inputs.efficacy_delta * 1.2),
    },
  ];

  if (params.utility_inputs) {
    parameters.push({
      name: "qaly_on_treatment",
      base_value: params.utility_inputs.qaly_on_treatment,
      low_value: Math.max(0.001, params.utility_inputs.qaly_on_treatment * 0.8),
      high_value: Math.min(0.999, params.utility_inputs.qaly_on_treatment * 1.2),
    });
    parameters.push({
      name: "qaly_comparator",
      base_value: params.utility_inputs.qaly_comparator,
      low_value: Math.max(0.001, params.utility_inputs.qaly_comparator * 0.8),
      high_value: Math.min(0.999, params.utility_inputs.qaly_comparator * 1.2),
    });
  }

  return parameters;
}
