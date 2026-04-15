/**
 * Expected Value of Partial Perfect Information (EVPPI)
 *
 * Per-parameter VOI analysis: shows which specific parameters are
 * worth further research by computing how much value would be gained
 * from resolving uncertainty in each parameter individually.
 *
 * Method: non-parametric regression (GAM approximation via binning)
 * following Strong et al. (2014) "Estimating multiparameter partial
 * expected value of perfect information from a probabilistic
 * sensitivity analysis sample"
 */

export interface EVPPIResult {
  parameter: string;
  evppi: number;
  evppi_proportion: number; // fraction of total EVPI explained
}

export interface PSAIterationData {
  delta_cost: number;
  delta_qaly: number;
  params: Record<string, number>; // parameter values for this iteration
}

/**
 * Compute EVPPI for each parameter using the binning method.
 *
 * For each parameter theta_j:
 * 1. Sort iterations by theta_j
 * 2. Bin into K groups
 * 3. Within each bin, compute E[max_arm(NMB)]
 * 4. EVPPI(theta_j) = E_bins[max(NMB_bin)] - max(E[NMB])
 */
export function computeEVPPI(
  iterations: PSAIterationData[],
  lambda: number,
  parameterNames: string[],
): EVPPIResult[] {
  const N = iterations.length;
  if (N < 20) return [];

  // Overall expected NMB for each arm
  const nmb_intervention_mean =
    iterations.reduce(
      (sum, it) => sum + (lambda * it.delta_qaly - it.delta_cost),
      0,
    ) / N;
  const nmb_comparator_mean = 0;
  const max_e_nmb = Math.max(nmb_intervention_mean, nmb_comparator_mean);

  // Total EVPI for reference
  const e_max_nmb =
    iterations.reduce((sum, it) => {
      const nmb_int = lambda * it.delta_qaly - it.delta_cost;
      return sum + Math.max(nmb_int, 0);
    }, 0) / N;
  const totalEVPI = Math.max(0, e_max_nmb - max_e_nmb);

  // Number of bins (Sturges' rule)
  const K = Math.max(5, Math.min(30, Math.ceil(1 + 3.322 * Math.log10(N))));
  const binSize = Math.ceil(N / K);

  const results: EVPPIResult[] = [];

  for (const paramName of parameterNames) {
    // Check if parameter exists in iterations
    if (iterations[0]?.params[paramName] === undefined) continue;

    // Sort by this parameter
    const sorted = [...iterations].sort(
      (a, b) => (a.params[paramName] ?? 0) - (b.params[paramName] ?? 0),
    );

    // Bin and compute conditional expectations
    let e_max_conditional = 0;

    for (let bin = 0; bin < K; bin++) {
      const start = bin * binSize;
      const end = Math.min(start + binSize, N);
      const binN = end - start;
      if (binN === 0) continue;

      // Expected NMB within this bin for intervention
      let sumNMBInt = 0;
      for (let i = start; i < end; i++) {
        const it = sorted[i]!;
        sumNMBInt += lambda * it.delta_qaly - it.delta_cost;
      }
      const meanNMBInt = sumNMBInt / binN;

      // Max of conditional expectations
      e_max_conditional += Math.max(meanNMBInt, 0) * (binN / N);
    }

    const evppi = Math.max(0, e_max_conditional - max_e_nmb);

    results.push({
      parameter: paramName,
      evppi,
      evppi_proportion: totalEVPI > 0 ? evppi / totalEVPI : 0,
    });
  }

  // Sort by EVPPI descending
  results.sort((a, b) => b.evppi - a.evppi);

  return results;
}
