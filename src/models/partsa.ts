/**
 * Partitioned Survival Analysis (PartSA) for oncology economic models.
 * Area-under-curve approach using survival functions.
 */

export interface SurvivalParams {
  os_median_months: number;    // overall survival median
  pfs_median_months: number;   // progression-free survival median
  distribution: "exponential" | "weibull";
  weibull_shape?: number;      // for weibull (default 1 = exponential)
}

export interface PartSAParams {
  intervention_survival: SurvivalParams;
  comparator_survival: SurvivalParams;
  states: ["PFS", "PD", "Dead"];  // always these 3 for PartSA
  utility_pfs: number;
  utility_pd: number;
  cost_pfs_annual: number;
  cost_pd_annual: number;
  n_cycles: number;
  cycle_length_years: number;
  discount_rate_costs: number;
  discount_rate_outcomes: number;
}

export interface PartSAResult {
  intervention: { total_cost: number; total_qaly: number; total_lys: number };
  comparator: { total_cost: number; total_qaly: number; total_lys: number };
}

/**
 * Compute survival function value at time t (in years).
 * For exponential: S(t) = exp(-lambda * t)
 * For Weibull: S(t) = exp(-(t/scale)^shape)
 */
function survivalAt(t: number, params: SurvivalParams, medianType: "os" | "pfs"): number {
  const medianMonths = medianType === "os" ? params.os_median_months : params.pfs_median_months;
  const medianYears = medianMonths / 12;

  if (params.distribution === "exponential" || (params.weibull_shape ?? 1) === 1) {
    // Exponential: lambda = log(2) / median
    const lambda = Math.log(2) / medianYears;
    return Math.exp(-lambda * t);
  } else {
    // Weibull: S(t) = exp(-(t/scale)^shape)
    const shape = params.weibull_shape ?? 1;
    // Derive scale from median: median = scale * (log(2))^(1/shape)
    const scale = medianYears / Math.pow(Math.log(2), 1 / shape);
    return Math.exp(-Math.pow(t / scale, shape));
  }
}

/**
 * Run one arm of PartSA.
 */
function runPartSAArm(
  survivalParams: SurvivalParams,
  utilityPFS: number,
  utilityPD: number,
  costPFSAnnual: number,
  costPDAnnual: number,
  nCycles: number,
  cycleLengthYears: number,
  discountRateCosts: number,
  discountRateOutcomes: number
): { total_cost: number; total_qaly: number; total_lys: number } {
  let total_cost = 0;
  let total_qaly = 0;
  let total_lys = 0;

  for (let cycle = 0; cycle <= nCycles; cycle++) {
    const t = cycle * cycleLengthYears;
    const s_pfs = survivalAt(t, survivalParams, "pfs");
    const s_os = survivalAt(t, survivalParams, "os");

    // Proportions in each state
    const prop_pfs = s_pfs;
    const prop_pd = Math.max(0, s_os - s_pfs);
    // const prop_dead = 1 - s_os; // not needed for calculations

    // Discount factors
    const discount_cost = 1 / Math.pow(1 + discountRateCosts, t);
    const discount_outcome = 1 / Math.pow(1 + discountRateOutcomes, t);

    // Half-cycle correction
    const isFirst = cycle === 0;
    const isLast = cycle === nCycles;
    const fraction = (isFirst || isLast) ? 0.5 : 1.0;

    const cycle_cost =
      (prop_pfs * costPFSAnnual + prop_pd * costPDAnnual) * cycleLengthYears * fraction * discount_cost;
    const cycle_qaly =
      (prop_pfs * utilityPFS + prop_pd * utilityPD) * cycleLengthYears * fraction * discount_outcome;
    const cycle_lys =
      (prop_pfs + prop_pd) * cycleLengthYears * fraction * discount_outcome;

    total_cost += cycle_cost;
    total_qaly += cycle_qaly;
    total_lys += cycle_lys;
  }

  return { total_cost, total_qaly, total_lys };
}

/**
 * Run Partitioned Survival Analysis for both arms.
 */
export function runPartSA(params: PartSAParams): PartSAResult {
  const intervention = runPartSAArm(
    params.intervention_survival,
    params.utility_pfs,
    params.utility_pd,
    params.cost_pfs_annual,
    params.cost_pd_annual,
    params.n_cycles,
    params.cycle_length_years,
    params.discount_rate_costs,
    params.discount_rate_outcomes
  );

  const comparator = runPartSAArm(
    params.comparator_survival,
    params.utility_pfs,
    params.utility_pd,
    params.cost_pfs_annual,
    params.cost_pd_annual,
    params.n_cycles,
    params.cycle_length_years,
    params.discount_rate_costs,
    params.discount_rate_outcomes
  );

  return { intervention, comparator };
}
