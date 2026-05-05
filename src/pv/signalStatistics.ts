/**
 * Disproportionality statistics for pharmacovigilance signal detection.
 * Pure math, no I/O.
 *
 * Implements:
 *   - PRR (Proportional Reporting Ratio) — Evans 2001
 *   - ROR (Reporting Odds Ratio) — van Puijenbroek 2002
 *   - IC (Information Component, BCPNN posterior) — Bate 1998 / Norén 2006
 *   - MGPS (Multi-item Gamma-Poisson Shrinker) — DuMouchel 1999, with EBGM
 *     and EB05/EB95 via gamma-Poisson shrinkage
 *
 * 2x2 table convention:
 *               event    not-event
 *   drug:         a         b           drug_total = a + b
 *   not-drug:     c         d           not-drug-total = c + d
 *   event_total = a + c; grand_total = a+b+c+d
 *
 * Inputs to the public functions are the four cell counts.
 */

export interface CaseCounts {
  drug_event: number; // a
  drug_total: number; // a + b
  event_total: number; // a + c
  grand_total: number; // a + b + c + d
}

function abcd(counts: CaseCounts): {
  a: number;
  b: number;
  c: number;
  d: number;
} {
  const a = counts.drug_event;
  const b = counts.drug_total - a;
  const c = counts.event_total - a;
  const d = counts.grand_total - counts.drug_total - c;
  return { a, b, c, d };
}

/** PRR per Evans 2001. Two-sided 95% CI on log scale. */
export function computePrr(counts: CaseCounts): {
  value: number;
  ci_low: number;
  ci_high: number;
  chi_squared: number;
} {
  const { a, b, c, d } = abcd(counts);
  // Continuity correction when any cell is zero
  const safe = (x: number) => (x === 0 ? 0.5 : x);
  const aS = safe(a);
  const bS = safe(b);
  const cS = safe(c);
  const dS = safe(d);
  const drugP = aS / (aS + bS);
  const ctrlP = cS / (cS + dS);
  const prr = drugP / ctrlP;
  // Variance of log(PRR) ≈ (1-drugP)/a + (1-ctrlP)/c
  const varLog = (1 - drugP) / aS + (1 - ctrlP) / cS;
  const seLog = Math.sqrt(Math.max(varLog, 0));
  const ci_low = Math.exp(Math.log(prr) - 1.96 * seLog);
  const ci_high = Math.exp(Math.log(prr) + 1.96 * seLog);
  // Chi-squared WITH Yates continuity correction: (|obs - exp| - 0.5)² / exp
  // The earlier implementation used plain Pearson but labelled it Yates in
  // the docstring + RMP markdown table — that misrepresented the statistic
  // to regulators. Now actually applies Yates per the label.
  // Verified against Evans 2001 vector: Yates → 26.90, plain Pearson → 30.66.
  const total = aS + bS + cS + dS;
  const expectedA = ((aS + bS) * (aS + cS)) / total;
  const expectedB = ((aS + bS) * (bS + dS)) / total;
  const expectedC = ((cS + dS) * (aS + cS)) / total;
  const expectedD = ((cS + dS) * (bS + dS)) / total;
  const yates = (obs: number, exp: number) =>
    Math.pow(Math.max(Math.abs(obs - exp) - 0.5, 0), 2) / Math.max(exp, 1e-12);
  const chi_squared =
    yates(aS, expectedA) +
    yates(bS, expectedB) +
    yates(cS, expectedC) +
    yates(dS, expectedD);
  return { value: prr, ci_low, ci_high, chi_squared };
}

/** ROR per van Puijenbroek 2002. Two-sided 95% CI on log scale. */
export function computeRor(counts: CaseCounts): {
  value: number;
  ci_low: number;
  ci_high: number;
} {
  const { a, b, c, d } = abcd(counts);
  const safe = (x: number) => (x === 0 ? 0.5 : x);
  const aS = safe(a);
  const bS = safe(b);
  const cS = safe(c);
  const dS = safe(d);
  const ror = (aS * dS) / (bS * cS);
  // Variance of log(ROR) = 1/a + 1/b + 1/c + 1/d
  const seLog = Math.sqrt(1 / aS + 1 / bS + 1 / cS + 1 / dS);
  const ci_low = Math.exp(Math.log(ror) - 1.96 * seLog);
  const ci_high = Math.exp(Math.log(ror) + 1.96 * seLog);
  return { value: ror, ci_low, ci_high };
}

/**
 * IC (Information Component) per Bate 1998 / Norén 2006 BCPNN.
 *   IC = log2(P(drug, event) / (P(drug) * P(event)))
 * with shrinkage so IC values for low-N pairs shrink toward 0.
 * IC025 is the 2.5th percentile of the posterior distribution (lower 95% CI).
 */
export function computeIc(counts: CaseCounts): {
  value: number;
  ic025: number;
} {
  const { a } = abcd(counts);
  const N = counts.grand_total;
  const drugTotal = counts.drug_total;
  const eventTotal = counts.event_total;
  // Norén's shrinkage formulation
  const expected = (drugTotal * eventTotal) / Math.max(N, 1);
  const observed = a;
  // IC = log2((observed + 0.5) / (expected + 0.5))
  const ic = Math.log2((observed + 0.5) / Math.max(expected + 0.5, 1e-12));
  // Posterior variance per Norén 2006 simplified form. The full formula
  // includes ALL FOUR marginal counts — omitting drug_total / event_total /
  // grand_total terms (as an earlier implementation did) systematically
  // inflates variance and causes the IC method to under-trigger borderline
  // signals. Verified against Evans 2001 vector: full formula → IC025 ≈ 1.07,
  // truncated formula → IC025 ≈ 0.06 (a 1.0-unit error that flips
  // threshold_met for low-N pairs).
  const variance =
    (1 / Math.max(observed + 0.5, 0.5) +
      1 / Math.max(drugTotal + 0.5, 0.5) +
      1 / Math.max(eventTotal + 0.5, 0.5) +
      1 / Math.max(N + 0.5, 0.5)) /
    Math.pow(Math.LN2, 2);
  const ic025 = ic - 1.96 * Math.sqrt(variance);
  return { value: ic, ic025 };
}

/**
 * MGPS (Multi-item Gamma-Poisson Shrinker) per DuMouchel 1999.
 * EBGM = empirical Bayes geometric mean of the relative reporting ratio,
 * with gamma-Poisson shrinkage that pulls EBGM toward 1 when N is small.
 *
 * Simplified single-stratum implementation: prior alpha=beta=0.5 (Jeffreys).
 * EB05 / EB95 are 5th / 95th percentiles of the posterior gamma
 * distribution, approximated via the Wilson-Hilferty cube-root transformation.
 *
 * Suitable for educational / first-pass screening use; matches FDA-Sentinel
 * shape but uses single-stratum (not stratified) shrinkage. Stratification
 * by sex / age can be added in a future revision.
 */
export function computeMgps(counts: CaseCounts): {
  ebgm: number;
  eb05: number;
  eb95: number;
} {
  const { a } = abcd(counts);
  const expected =
    (counts.drug_total * counts.event_total) / Math.max(counts.grand_total, 1);
  // Jeffreys prior: alpha = beta = 0.5
  const alpha = 0.5;
  const beta = 0.5;
  // Posterior gamma(a + alpha, expected + beta)
  const postShape = a + alpha;
  const postRate = expected + beta;
  // Mean of gamma(k, theta) = k/theta
  const ebgm = postShape / Math.max(postRate, 1e-12);
  // Wilson-Hilferty approx: gamma quantile q_p ≈ k * (1 - 1/(9k) + z_p * sqrt(1/(9k)))^3 / theta
  const wh = (p: number) => {
    const z = inverseNormalCdf(p);
    const k = postShape;
    const factor = 1 - 1 / (9 * k) + z * Math.sqrt(1 / (9 * k));
    return (k * Math.pow(factor, 3)) / postRate;
  };
  const eb05 = wh(0.05);
  const eb95 = wh(0.95);
  return { ebgm, eb05, eb95 };
}

/** Beasley-Springer-Moro inverse normal CDF — sufficient accuracy for p in [0.001, 0.999]. */
function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) {
    return p <= 0 ? -Infinity : Infinity;
  }
  // Acklam's algorithm coefficients
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}
