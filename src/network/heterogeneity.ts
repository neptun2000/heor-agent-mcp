/**
 * Heterogeneity statistics for meta-analysis / network meta-analysis.
 *
 * Implements Cochran's Q, I², τ² (DerSimonian-Laird), and Cochrane-standard
 * interpretation bands. Pure functions — no side effects.
 *
 * References:
 * - Higgins JPT, Thompson SG. Quantifying heterogeneity in a meta-analysis.
 *   Stat Med. 2002;21:1539-1558.
 * - Cochrane Handbook for Systematic Reviews of Interventions, Chapter 10.10.
 */

export interface StudyEffect {
  /** Point estimate of the treatment effect (log-scale for OR/HR/RR). */
  estimate: number;
  /** Standard error of the estimate. */
  se: number;
}

export interface HeterogeneityResult {
  /** Cochran's Q test statistic. */
  cochran_q: number;
  /** Degrees of freedom (k - 1). */
  df: number;
  /** Two-sided p-value for H0: no heterogeneity. */
  p_value: number;
  /** I² statistic as percentage (0-100). */
  i_squared_pct: number;
  /** Between-study variance (DerSimonian-Laird estimator). */
  tau_squared: number;
  /** Cochrane interpretation: might_not_be_important / moderate / substantial / considerable. */
  interpretation:
    | "might_not_be_important"
    | "moderate"
    | "substantial"
    | "considerable";
  /** Human-readable interpretation label with band. */
  interpretation_band: string;
  /** Number of studies included in the calculation. */
  n_studies: number;
}

/**
 * Compute Cochran's Q statistic.
 *
 * Q = Σ w_i * (y_i - ȳ)²,   where w_i = 1 / SE_i², ȳ = Σ(w_i * y_i) / Σ w_i
 *
 * Under H0 (homogeneity), Q ~ χ²(k-1).
 */
export function cochranQ(effects: StudyEffect[]): {
  q: number;
  df: number;
  weighted_mean: number;
} {
  if (effects.length < 2) {
    return { q: 0, df: 0, weighted_mean: effects[0]?.estimate ?? 0 };
  }
  const weights = effects.map((e) => 1 / (e.se * e.se));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const weighted_mean =
    effects.reduce((acc, e, i) => acc + weights[i] * e.estimate, 0) / sumW;
  const q = effects.reduce(
    (acc, e, i) =>
      acc + weights[i] * (e.estimate - weighted_mean) * (e.estimate - weighted_mean),
    0,
  );
  return { q, df: effects.length - 1, weighted_mean };
}

/**
 * I² statistic.
 *
 *   I² = max(0, 100% × (Q − df) / Q)
 */
export function iSquared(q: number, df: number): number {
  if (q <= 0 || df <= 0) return 0;
  return Math.max(0, (100 * (q - df)) / q);
}

/**
 * DerSimonian-Laird between-study variance τ².
 *
 *   τ² = max(0, (Q − df) / (Σw_i − Σw_i² / Σw_i))
 */
export function tauSquared(effects: StudyEffect[], q: number, df: number): number {
  if (effects.length < 2 || q <= df) return 0;
  const weights = effects.map((e) => 1 / (e.se * e.se));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const sumW2 = weights.reduce((a, b) => a + b * b, 0);
  const c = sumW - sumW2 / sumW;
  if (c <= 0) return 0;
  return Math.max(0, (q - df) / c);
}

/**
 * Upper-tail probability of χ²(df) evaluated at q.
 *
 * Uses a series approximation for the regularised upper incomplete gamma function.
 * Accurate to ~1e-6 for typical meta-analysis Q values (df < 100, q < 200).
 */
export function chiSquaredPValue(q: number, df: number): number {
  if (df <= 0 || q <= 0) return 1;
  // P(Q > q) = 1 - regularized_lower_gamma(df/2, q/2)
  const a = df / 2;
  const x = q / 2;
  // Use series for x < a + 1, continued fraction otherwise (Numerical Recipes)
  if (x < a + 1) {
    // Series expansion of P(a, x)
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-10) break;
    }
    const lowerIncomplete = sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    return Math.max(0, Math.min(1, 1 - lowerIncomplete));
  } else {
    // Continued fraction for Q(a, x) directly
    const FPMIN = 1e-300;
    let b = x + 1 - a;
    let c = 1 / FPMIN;
    let d = 1 / b;
    let h = d;
    for (let n = 1; n < 200; n++) {
      const an = -n * (n - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 1e-10) break;
    }
    const upperIncomplete = h * Math.exp(-x + a * Math.log(x) - logGamma(a));
    return Math.max(0, Math.min(1, upperIncomplete));
  }
}

function logGamma(x: number): number {
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < c.length; i++) {
    a += c[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function interpretI2(i2: number): {
  interpretation: HeterogeneityResult["interpretation"];
  interpretation_band: string;
} {
  if (i2 < 30) {
    return {
      interpretation: "might_not_be_important",
      interpretation_band: "0–40% → might not be important",
    };
  }
  if (i2 < 50) {
    return {
      interpretation: "moderate",
      interpretation_band: "30–60% → moderate heterogeneity",
    };
  }
  if (i2 < 75) {
    return {
      interpretation: "substantial",
      interpretation_band: "50–90% → substantial heterogeneity",
    };
  }
  return {
    interpretation: "considerable",
    interpretation_band: "75–100% → considerable heterogeneity",
  };
}

/**
 * Compute the full heterogeneity summary for a set of study effect estimates.
 *
 * Returns zeros and "might_not_be_important" when fewer than 2 studies.
 */
export function computeHeterogeneity(effects: StudyEffect[]): HeterogeneityResult {
  const n = effects.length;
  if (n < 2) {
    return {
      cochran_q: 0,
      df: 0,
      p_value: 1,
      i_squared_pct: 0,
      tau_squared: 0,
      interpretation: "might_not_be_important",
      interpretation_band: "insufficient studies (n < 2)",
      n_studies: n,
    };
  }

  const { q, df } = cochranQ(effects);
  const i2 = iSquared(q, df);
  const tau2 = tauSquared(effects, q, df);
  const p = chiSquaredPValue(q, df);
  const { interpretation, interpretation_band } = interpretI2(i2);

  return {
    cochran_q: q,
    df,
    p_value: p,
    i_squared_pct: i2,
    tau_squared: tau2,
    interpretation,
    interpretation_band,
    n_studies: n,
  };
}
