/**
 * Probabilistic Sensitivity Analysis (PSA) using Monte Carlo simulation.
 */

import type { CEModelParams } from "../providers/types.js";
import { betaSample, gammaSample, createSeededRng } from "./distributions.js";
import {
  buildMarkovParamsFromCE,
  runMarkovAndComputeICER,
} from "./modelUtils.js";
import {
  computeEVPPI,
  type EVPPIResult,
  type PSAIterationData,
} from "./evppi.js";

export type CEModelInputs = CEModelParams;

export interface PSAParams {
  base_params: CEModelInputs;
  n_iterations: number;
  seed?: number;
  /** WTP threshold for EVPI calculation. Defaults to perspective-appropriate value. */
  evpi_lambda?: number;
}

export interface PSAIteration {
  delta_cost: number;
  delta_qaly: number;
  icer: number;
}

export interface PSAResult {
  iterations: PSAIteration[];
  mean_icer: number;
  ci_icer_lower: number; // 2.5th percentile
  ci_icer_upper: number; // 97.5th percentile
  prob_cost_effective: Record<string, number>; // keyed by threshold name
  ceac: Array<{ wtp: number; prob_ce: number }>;
  evpi: number;
  evppi: EVPPIResult[]; // per-parameter partial EVPI
  scatter_sample: PSAIteration[]; // first 500 iterations for scatter plot
}

const WTP_THRESHOLDS_PSA: Record<string, number> = {
  nhs_low: 25000,
  nhs_high: 35000,
  us_payer_low: 100000,
  us_payer_mid: 150000,
  societal: 50000,
};

/**
 * Perturb a parameter using Beta distribution (for utilities/probabilities).
 * Uses ±10% relative variance by default.
 */
function perturbBeta(value: number, cv: number, rng: () => number): number {
  const mean = Math.max(0.001, Math.min(0.999, value));
  const variance = Math.pow(mean * cv, 2);
  // Clamp variance so alpha/beta are positive
  const maxVariance = mean * (1 - mean) * 0.99;
  const safeVariance = Math.min(variance, maxVariance);
  return betaSample(mean, safeVariance, rng);
}

/**
 * Perturb a cost parameter using Gamma distribution.
 * Uses 20% CV by default.
 */
function perturbGamma(value: number, cv: number, rng: () => number): number {
  const mean = Math.max(1, value);
  const variance = Math.pow(mean * cv, 2);
  return gammaSample(mean, variance, rng);
}

/**
 * Run PSA: Monte Carlo simulation over uncertain parameters.
 */
export function runPSA(params: PSAParams): PSAResult {
  const rng = createSeededRng(params.seed ?? 42);
  const iterations: PSAIteration[] = [];
  const evppiData: PSAIterationData[] = [];

  for (let i = 0; i < params.n_iterations; i++) {
    // Sample perturbed parameters
    const perturbedParams: CEModelInputs = {
      ...params.base_params,
      clinical_inputs: {
        ...params.base_params.clinical_inputs,
        efficacy_delta: perturbBeta(
          Math.max(
            0.001,
            Math.min(0.999, params.base_params.clinical_inputs.efficacy_delta),
          ),
          0.1,
          rng,
        ),
        mortality_reduction:
          params.base_params.clinical_inputs.mortality_reduction !== undefined
            ? perturbBeta(
                Math.max(
                  0.001,
                  Math.min(
                    0.999,
                    params.base_params.clinical_inputs.mortality_reduction,
                  ),
                ),
                0.1,
                rng,
              )
            : undefined,
      },
      cost_inputs: {
        drug_cost_annual: perturbGamma(
          params.base_params.cost_inputs.drug_cost_annual,
          0.2,
          rng,
        ),
        comparator_cost_annual: perturbGamma(
          params.base_params.cost_inputs.comparator_cost_annual,
          0.2,
          rng,
        ),
        admin_cost:
          params.base_params.cost_inputs.admin_cost !== undefined
            ? perturbGamma(params.base_params.cost_inputs.admin_cost, 0.2, rng)
            : undefined,
        ae_cost:
          params.base_params.cost_inputs.ae_cost !== undefined
            ? perturbGamma(params.base_params.cost_inputs.ae_cost, 0.2, rng)
            : undefined,
      },
      utility_inputs: params.base_params.utility_inputs
        ? {
            qaly_on_treatment: perturbBeta(
              params.base_params.utility_inputs.qaly_on_treatment,
              0.05,
              rng,
            ),
            qaly_comparator: perturbBeta(
              params.base_params.utility_inputs.qaly_comparator,
              0.05,
              rng,
            ),
          }
        : undefined,
    };

    const { delta_cost, delta_qaly, icer } =
      runMarkovAndComputeICER(perturbedParams);
    iterations.push({ delta_cost, delta_qaly, icer });

    // Track parameter values for EVPPI
    evppiData.push({
      delta_cost,
      delta_qaly,
      params: {
        efficacy_delta: perturbedParams.clinical_inputs.efficacy_delta,
        drug_cost_annual: perturbedParams.cost_inputs.drug_cost_annual,
        comparator_cost_annual:
          perturbedParams.cost_inputs.comparator_cost_annual,
        ...(perturbedParams.clinical_inputs.mortality_reduction !== undefined
          ? {
              mortality_reduction:
                perturbedParams.clinical_inputs.mortality_reduction,
            }
          : {}),
        ...(perturbedParams.utility_inputs
          ? {
              qaly_on_treatment:
                perturbedParams.utility_inputs.qaly_on_treatment,
              qaly_comparator: perturbedParams.utility_inputs.qaly_comparator,
            }
          : {}),
      },
    });
  }

  // Compute statistics
  const finiteICERs = iterations
    .map((it) => it.icer)
    .filter((ic) => isFinite(ic));
  const sortedICERs = [...finiteICERs].sort((a, b) => a - b);

  const mean_icer =
    finiteICERs.length > 0
      ? finiteICERs.reduce((a, b) => a + b, 0) / finiteICERs.length
      : Infinity;

  const ci_icer_lower =
    sortedICERs.length > 0
      ? (sortedICERs[Math.floor(sortedICERs.length * 0.025)] ?? sortedICERs[0]!)
      : 0;
  const ci_icer_upper =
    sortedICERs.length > 0
      ? (sortedICERs[Math.floor(sortedICERs.length * 0.975)] ??
        sortedICERs[sortedICERs.length - 1]!)
      : 0;

  // Probability cost-effective at named thresholds
  const prob_cost_effective: Record<string, number> = {};
  for (const [name, wtp] of Object.entries(WTP_THRESHOLDS_PSA)) {
    const n_ce = iterations.filter(
      (it) => wtp * it.delta_qaly - it.delta_cost > 0,
    ).length;
    prob_cost_effective[name] = n_ce / iterations.length;
  }

  // CEAC: WTP from $0 to $300,000 in $5,000 steps
  const ceac: Array<{ wtp: number; prob_ce: number }> = [];
  for (let wtp = 0; wtp <= 300000; wtp += 5000) {
    const n_ce = iterations.filter(
      (it) => wtp * it.delta_qaly - it.delta_cost > 0,
    ).length;
    ceac.push({ wtp, prob_ce: n_ce / iterations.length });
  }

  // EVPI: E[max_arm(NMB)] - max_arm(E[NMB])
  // Use perspective-appropriate WTP threshold (passed via evpi_lambda)
  const lambda = params.evpi_lambda ?? 50000;
  const nmb_intervention_mean =
    iterations.reduce(
      (sum, it) => sum + (lambda * it.delta_qaly - it.delta_cost),
      0,
    ) / iterations.length;
  const nmb_comparator_mean = 0; // comparator is reference (delta = 0)
  const e_max_nmb =
    iterations.reduce((sum, it) => {
      const nmb_int = lambda * it.delta_qaly - it.delta_cost;
      return sum + Math.max(nmb_int, nmb_comparator_mean);
    }, 0) / iterations.length;
  const max_e_nmb = Math.max(nmb_intervention_mean, nmb_comparator_mean);
  const evpi = Math.max(0, e_max_nmb - max_e_nmb);

  // EVPPI: per-parameter partial value of information
  const paramNames =
    evppiData.length > 0 ? Object.keys(evppiData[0]!.params) : [];
  const evppiResults = computeEVPPI(evppiData, lambda, paramNames);

  const scatter_sample = iterations.slice(0, 500);

  return {
    iterations,
    mean_icer,
    ci_icer_lower,
    ci_icer_upper,
    prob_cost_effective,
    ceac,
    evpi,
    evppi: evppiResults,
    scatter_sample,
  };
}
