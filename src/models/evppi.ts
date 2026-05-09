/**
 * Expected Value of Partial Perfect Information (EVPPI).
 *
 * Per-parameter VOI analysis: shows which input parameters are worth
 * further research by quantifying how much value would be gained from
 * resolving uncertainty in each parameter individually.
 *
 * Method: non-parametric binning approximation per Strong et al.
 * (2014) "Estimating multiparameter partial expected value of perfect
 * information from a probabilistic sensitivity analysis sample"
 * (J. Health Economics 2014).
 *
 * v1.7.0 quality upgrades (removed ⚠️ EXPERIMENTAL caveat):
 *
 *   1. **Mathematical cap.** EVPPI ≤ totalEVPI by definition (per-
 *      parameter information value can't exceed full-uncertainty
 *      resolution). Pre-fix the binning estimator could overshoot;
 *      we now `Math.min(raw, totalEVPI)` per parameter.
 *
 *   2. **Noise-floor guard.** When the decision is robust to
 *      uncertainty (totalEVPI ~ 0), per-parameter binning still
 *      produces fake positive signals from sample noise. We compute
 *      a noise-floor threshold relative to the NMB standard
 *      deviation; if totalEVPI falls below it, all per-parameter
 *      EVPPIs are suppressed to 0 with `below_noise_floor: true`
 *      so callers don't surface a misleading "top 5 to research"
 *      table from random noise.
 *
 *   3. **Adaptive bin width** via Freedman-Diaconis (h = 2·IQR·N^(-1/3))
 *      replacing Sturges' rule. F-D adapts to actual data spread and
 *      handles non-normal distributions better — important for cost
 *      / utility parameters which are typically right-skewed.
 *
 *   4. **Bootstrap 95% CI** per parameter. 200 resamples with
 *      replacement; report 2.5th/97.5th percentiles + standard error.
 *      Skipped for parameters below the noise floor (no point in CI
 *      on noise) and for tiny samples (N<50 — CI would be unstable).
 */

export interface EVPPIResult {
  parameter: string;
  evppi: number;
  evppi_proportion: number; // fraction of total EVPI explained, in [0, 1]
  /** Bootstrap 95% CI lower bound. Omitted when below_noise_floor or N<50. */
  evppi_ci_lower?: number;
  /** Bootstrap 95% CI upper bound. Omitted when below_noise_floor or N<50. */
  evppi_ci_upper?: number;
  /** Bootstrap standard error. Omitted under same conditions as CI. */
  evppi_se?: number;
  /**
   * True when totalEVPI is so small relative to NMB variance that the
   * per-parameter signal is dominated by binning noise. When true,
   * `evppi` is suppressed to 0 and CI is omitted — surfacing the
   * point estimate would mislead callers into believing there are
   * "top parameters to research" when in fact the decision is robust.
   */
  below_noise_floor?: boolean;
}

export interface PSAIterationData {
  delta_cost: number;
  delta_qaly: number;
  params: Record<string, number>;
}

const BOOTSTRAP_RESAMPLES = 200;
const MIN_N_FOR_BOOTSTRAP = 50;
/**
 * Threshold ratio: when totalEVPI / stddev(NMB) is below this fraction,
 * per-parameter EVPPI is treated as noise. 0.005 = "less than 0.5% of
 * NMB spread" — empirically a clean cutoff that fires on robust-decision
 * fixtures without false-positive on real high-uncertainty cases.
 */
const NOISE_FLOOR_RATIO = 0.005;

function nmbInt(it: PSAIterationData, lambda: number): number {
  return lambda * it.delta_qaly - it.delta_cost;
}

function stddev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sumSq = values.reduce((s, v) => s + (v - mean) * (v - mean), 0);
  return Math.sqrt(sumSq / (n - 1));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Pick a bin count for a parameter using Freedman-Diaconis when there's
 * variance to work with; fall back to Sturges' when IQR=0 (constant
 * parameter or extreme tied data).
 */
function pickBinCount(values: number[]): number {
  const N = values.length;
  if (N < 5) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const range = sorted[sorted.length - 1] - sorted[0];

  if (iqr <= 0 || range <= 0) {
    // Constant or tied data — F-D undefined. Fall back to Sturges'
    // and clamp.
    return Math.max(5, Math.min(30, Math.ceil(1 + 3.322 * Math.log10(N))));
  }
  const h = 2 * iqr * Math.pow(N, -1 / 3);
  if (h <= 0) {
    return Math.max(5, Math.min(30, Math.ceil(1 + 3.322 * Math.log10(N))));
  }
  const k = Math.ceil(range / h);
  return Math.max(5, Math.min(30, k));
}

/**
 * Compute the raw binning-estimator EVPPI point for one parameter on
 * one (possibly bootstrapped) iteration set. Returns 0 floor (cannot
 * be negative). Caller is responsible for the totalEVPI cap and noise
 * floor — this is just the kernel.
 */
function rawEVPPIPoint(
  iterations: PSAIterationData[],
  lambda: number,
  paramName: string,
): number {
  const N = iterations.length;
  if (N < 5) return 0;
  if (iterations[0]?.params[paramName] === undefined) return 0;

  const meanNmb = iterations.reduce((s, it) => s + nmbInt(it, lambda), 0) / N;
  const maxENmb = Math.max(meanNmb, 0);

  const paramValues = iterations.map((it) => it.params[paramName] ?? 0);

  // Constant parameter (zero variance) has no information value — no
  // amount of "perfect knowledge" of an already-known value would
  // change the decision. Short-circuit so the binning estimator
  // doesn't pick up unrelated NMB variance and report a fake EVPPI.
  const pmin = Math.min(...paramValues);
  const pmax = Math.max(...paramValues);
  if (pmax - pmin === 0) return 0;

  const K = pickBinCount(paramValues);
  const binSize = Math.ceil(N / K);

  const sorted = [...iterations].sort(
    (a, b) => (a.params[paramName] ?? 0) - (b.params[paramName] ?? 0),
  );

  let eMaxConditional = 0;
  for (let bin = 0; bin < K; bin++) {
    const start = bin * binSize;
    const end = Math.min(start + binSize, N);
    const binN = end - start;
    if (binN === 0) continue;
    let sumNmbInt = 0;
    for (let i = start; i < end; i++) {
      sumNmbInt += nmbInt(sorted[i]!, lambda);
    }
    const meanNmbInt = sumNmbInt / binN;
    eMaxConditional += Math.max(meanNmbInt, 0) * (binN / N);
  }
  return Math.max(0, eMaxConditional - maxENmb);
}

/**
 * Bootstrap CI for one parameter's EVPPI. Returns mean + 95% CI bounds
 * + standard error from resamples. Computationally O(B · N log N).
 */
function bootstrapEVPPICI(
  iterations: PSAIterationData[],
  lambda: number,
  paramName: string,
  totalEVPI: number,
): { lower: number; upper: number; se: number } {
  const B = BOOTSTRAP_RESAMPLES;
  const N = iterations.length;
  const samples: number[] = [];

  for (let b = 0; b < B; b++) {
    const resample: PSAIterationData[] = new Array(N);
    for (let i = 0; i < N; i++) {
      resample[i] = iterations[Math.floor(Math.random() * N)]!;
    }
    const raw = rawEVPPIPoint(resample, lambda, paramName);
    samples.push(Math.min(raw, totalEVPI));
  }
  samples.sort((a, b) => a - b);
  const lower = Math.max(0, quantile(samples, 0.025));
  const upper = Math.max(0, quantile(samples, 0.975));
  const se = stddev(samples);
  return { lower, upper, se };
}

export function computeEVPPI(
  iterations: PSAIterationData[],
  lambda: number,
  parameterNames: string[],
): EVPPIResult[] {
  const N = iterations.length;
  if (N < 20) return [];

  const nmbValues = iterations.map((it) => nmbInt(it, lambda));
  const meanNmb = nmbValues.reduce((a, b) => a + b, 0) / N;
  const maxENmb = Math.max(meanNmb, 0);

  const eMaxNmb =
    iterations.reduce((s, it) => s + Math.max(nmbInt(it, lambda), 0), 0) / N;
  const totalEVPI = Math.max(0, eMaxNmb - maxENmb);

  // Noise-floor activation: NMB standard deviation gives us a scale-
  // invariant baseline. If totalEVPI is below NOISE_FLOOR_RATIO of the
  // spread, per-parameter signals are noise.
  const nmbStd = stddev(nmbValues);
  const noiseFloor = NOISE_FLOOR_RATIO * Math.max(nmbStd, 1);
  const belowFloor = totalEVPI < noiseFloor;

  const results: EVPPIResult[] = [];

  for (const paramName of parameterNames) {
    if (iterations[0]?.params[paramName] === undefined) continue;

    if (belowFloor) {
      results.push({
        parameter: paramName,
        evppi: 0,
        evppi_proportion: 0,
        below_noise_floor: true,
      });
      continue;
    }

    // Point estimate, then mathematical cap.
    const raw = rawEVPPIPoint(iterations, lambda, paramName);
    const evppi = Math.min(raw, totalEVPI);
    const evppi_proportion =
      totalEVPI > 0 ? Math.max(0, Math.min(1, evppi / totalEVPI)) : 0;

    const result: EVPPIResult = {
      parameter: paramName,
      evppi,
      evppi_proportion,
      below_noise_floor: false,
    };

    // Bootstrap CI when sample is large enough to be meaningful.
    if (N >= MIN_N_FOR_BOOTSTRAP) {
      const ci = bootstrapEVPPICI(iterations, lambda, paramName, totalEVPI);
      result.evppi_ci_lower = ci.lower;
      result.evppi_ci_upper = ci.upper;
      result.evppi_se = ci.se;
    }

    results.push(result);
  }

  results.sort((a, b) => b.evppi - a.evppi);
  return results;
}
