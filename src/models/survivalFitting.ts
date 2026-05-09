/**
 * Survival Curve Fitting — fit parametric distributions.
 *
 * Two input paths:
 *   1. **Patient-level event data** (the canonical path; v1.9.0+): array of
 *      `{time, event}` rows where `event=1` for an observed event and
 *      `event=0` for right-censoring. Standard right-censored MLE per
 *      Collett (2015) — log-likelihood is `Σᵢ [δᵢ·log(f(tᵢ)) + (1-δᵢ)·log(S(tᵢ))]`.
 *      This is the proper TSD-14 method and what NICE expects. No longer
 *      ⚠️ EXPERIMENTAL.
 *   2. **KM step-summary data** (legacy path, kept for back-compat): array
 *      of `{time, survival, n_at_risk?}` from a published KM curve. Treated
 *      as interval-censored — back out events/censored from the survival
 *      drops between consecutive points. Approximation, not true MLE on
 *      the underlying patient times. Output flags this clearly.
 *
 * Supports: Exponential, Weibull, Log-logistic, Log-normal, Gompertz.
 * Optimization: Nelder-Mead simplex (no derivatives needed).
 * Model selection via AIC / BIC.
 *
 * References:
 * - Latimer NR. NICE DSU TSD 14: Survival analysis (2013)
 * - Collett D. Modelling Survival Data in Medical Research (2015)
 * - Klein JP, Moeschberger ML. Survival Analysis (2003) — MLE chapter
 */

export interface KMDataPoint {
  time: number; // in months or years (specify in timeUnit)
  survival: number; // proportion surviving (0-1)
  n_at_risk?: number; // optional: patients at risk
  n_events?: number; // optional: events in interval
}

/**
 * Patient-level event data row. The canonical TSD-14 input shape.
 * `event = 1` → event observed at time `t`; `event = 0` → right-censored
 * (last seen alive at time `t`, status unknown after).
 */
export interface EventDataPoint {
  time: number;
  event: 0 | 1;
}

export type DistributionName =
  | "exponential"
  | "weibull"
  | "log_logistic"
  | "log_normal"
  | "gompertz";

export interface FittedDistribution {
  name: DistributionName;
  params: Record<string, number>;
  aic: number;
  bic: number;
  log_likelihood: number;
  survival_at: (t: number) => number;
  hazard_at: (t: number) => number;
  median_survival: number;
  mean_survival_restricted: number; // restricted mean (up to max observed time)
}

export interface SurvivalFitResult {
  fits: FittedDistribution[];
  best_aic: FittedDistribution;
  best_bic: FittedDistribution;
  km_data: KMDataPoint[];
  time_unit: string;
  extrapolations: Array<{
    time: number;
    km_observed?: number;
    exponential: number;
    weibull: number;
    log_logistic: number;
    log_normal: number;
    gompertz: number;
  }>;
}

// --- Distribution functions ---

function expSurvival(t: number, lambda: number): number {
  return Math.exp(-lambda * t);
}

function expHazard(_t: number, lambda: number): number {
  return lambda;
}

function weibullSurvival(t: number, shape: number, scale: number): number {
  if (t <= 0) return 1;
  return Math.exp(-Math.pow(t / scale, shape));
}

function weibullHazard(t: number, shape: number, scale: number): number {
  if (t <= 0) return 0;
  return (shape / scale) * Math.pow(t / scale, shape - 1);
}

function logLogisticSurvival(t: number, alpha: number, beta: number): number {
  if (t <= 0) return 1;
  return 1 / (1 + Math.pow(t / alpha, beta));
}

function logLogisticHazard(t: number, alpha: number, beta: number): number {
  if (t <= 0) return 0;
  const num = (beta / alpha) * Math.pow(t / alpha, beta - 1);
  const den = 1 + Math.pow(t / alpha, beta);
  return num / den;
}

function logNormalSurvival(t: number, mu: number, sigma: number): number {
  if (t <= 0) return 1;
  // S(t) = 1 - Phi((ln(t) - mu) / sigma)
  const z = (Math.log(t) - mu) / sigma;
  return 1 - normalCDF(z);
}

function logNormalHazard(t: number, mu: number, sigma: number): number {
  if (t <= 0) return 0;
  const z = (Math.log(t) - mu) / sigma;
  const phi = normalPDF(z);
  const bigPhi = normalCDF(z);
  return phi / (sigma * t * (1 - bigPhi));
}

function gompertzSurvival(t: number, shape: number, rate: number): number {
  if (t <= 0) return 1;
  if (Math.abs(shape) < 1e-10) return Math.exp(-rate * t);
  return Math.exp(-(rate / shape) * (Math.exp(shape * t) - 1));
}

function gompertzHazard(t: number, shape: number, rate: number): number {
  return rate * Math.exp(shape * t);
}

// --- Normal distribution helpers ---

function normalPDF(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

function normalCDF(z: number): number {
  // Abramowitz & Stegun approximation (error < 7.5e-8)
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

// --- Log-likelihood computation ---

/**
 * Compute log-likelihood for interval-censored KM data.
 * Each KM step represents an interval where the survival function
 * drops — we compute the likelihood of the observed survival proportions.
 */
function logLikelihood(
  data: KMDataPoint[],
  survFn: (t: number) => number,
): number {
  let ll = 0;
  for (let i = 0; i < data.length; i++) {
    const observed = data[i]!.survival;
    const predicted = Math.max(
      1e-15,
      Math.min(1 - 1e-15, survFn(data[i]!.time)),
    );

    // Events in this interval
    const nAtRisk = data[i]!.n_at_risk ?? 100;
    const prevSurv = i === 0 ? 1 : data[i - 1]!.survival;
    const events = Math.round((prevSurv - observed) * nAtRisk);
    const censored = Math.max(
      0,
      (i === 0 ? nAtRisk : (data[i]!.n_at_risk ?? nAtRisk)) - events,
    );

    // Contribution: events contribute log(f(t)), censored contribute log(S(t))
    if (events > 0) {
      const prevPredicted = i === 0 ? 1 : survFn(data[i - 1]!.time);
      const density = Math.max(1e-15, prevPredicted - predicted);
      ll += events * Math.log(density);
    }
    if (censored > 0) {
      ll += censored * Math.log(predicted);
    }
  }
  return ll;
}

// --- Optimization (grid search + Nelder-Mead simplex) ---

function nelderMead(
  fn: (params: number[]) => number,
  initial: number[],
  maxIter: number = 500,
): number[] {
  const n = initial.length;
  const alpha = 1;
  const gamma = 2;
  const rho = 0.5;
  const sigma = 0.5;

  // Build initial simplex
  const simplex: { point: number[]; value: number }[] = [];
  simplex.push({ point: [...initial], value: fn(initial) });

  for (let i = 0; i < n; i++) {
    const point = [...initial];
    point[i] = point[i]! * 1.5 + 0.1;
    simplex.push({ point, value: fn(point) });
  }

  for (let iter = 0; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.value - b.value);

    // Centroid (excluding worst)
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        centroid[j] += simplex[i]!.point[j]! / n;
      }
    }

    const worst = simplex[n]!;

    // Reflection
    const reflected = centroid.map((c, j) => c + alpha * (c - worst.point[j]!));
    const fReflected = fn(reflected);

    if (fReflected < simplex[n - 1]!.value && fReflected >= simplex[0]!.value) {
      simplex[n] = { point: reflected, value: fReflected };
      continue;
    }

    if (fReflected < simplex[0]!.value) {
      // Expansion
      const expanded = centroid.map((c, j) => c + gamma * (reflected[j]! - c));
      const fExpanded = fn(expanded);
      simplex[n] =
        fExpanded < fReflected
          ? { point: expanded, value: fExpanded }
          : { point: reflected, value: fReflected };
      continue;
    }

    // Contraction
    const contracted = centroid.map((c, j) => c + rho * (worst.point[j]! - c));
    const fContracted = fn(contracted);

    if (fContracted < worst.value) {
      simplex[n] = { point: contracted, value: fContracted };
      continue;
    }

    // Shrink
    const best = simplex[0]!.point;
    for (let i = 1; i <= n; i++) {
      simplex[i]!.point = simplex[i]!.point.map(
        (p, j) => best[j]! + sigma * (p - best[j]!),
      );
      simplex[i]!.value = fn(simplex[i]!.point);
    }
  }

  simplex.sort((a, b) => a.value - b.value);
  return simplex[0]!.point;
}

// --- Fitting functions ---

function fitExponential(data: KMDataPoint[]): FittedDistribution {
  // MLE for exponential: lambda = events / total_time
  // Use optimization for consistency with interval-censored data
  const medianTime =
    data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;
  const lambdaInit = Math.log(2) / medianTime;

  const opt = nelderMead(
    (p) => -logLikelihood(data, (t) => expSurvival(t, Math.max(1e-6, p[0]!))),
    [lambdaInit],
  );

  const lambda = Math.max(1e-6, opt[0]!);
  const ll = logLikelihood(data, (t) => expSurvival(t, lambda));
  const k = 1;
  const n = data.length;

  return {
    name: "exponential",
    params: { lambda },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: (t) => expSurvival(t, lambda),
    hazard_at: (t) => expHazard(t, lambda),
    median_survival: Math.log(2) / lambda,
    mean_survival_restricted: restrictedMean(data, (t) =>
      expSurvival(t, lambda),
    ),
  };
}

function fitWeibull(data: KMDataPoint[]): FittedDistribution {
  const medianTime =
    data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;
  const scaleInit = medianTime / Math.pow(Math.log(2), 1);

  const opt = nelderMead(
    (p) =>
      -logLikelihood(data, (t) =>
        weibullSurvival(t, Math.max(0.1, p[0]!), Math.max(0.01, p[1]!)),
      ),
    [1.0, scaleInit],
  );

  const shape = Math.max(0.1, opt[0]!);
  const scale = Math.max(0.01, opt[1]!);
  const ll = logLikelihood(data, (t) => weibullSurvival(t, shape, scale));
  const k = 2;
  const n = data.length;
  const median = scale * Math.pow(Math.log(2), 1 / shape);

  return {
    name: "weibull",
    params: { shape, scale },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: (t) => weibullSurvival(t, shape, scale),
    hazard_at: (t) => weibullHazard(t, shape, scale),
    median_survival: median,
    mean_survival_restricted: restrictedMean(data, (t) =>
      weibullSurvival(t, shape, scale),
    ),
  };
}

function fitLogLogistic(data: KMDataPoint[]): FittedDistribution {
  const medianTime =
    data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;

  const opt = nelderMead(
    (p) =>
      -logLikelihood(data, (t) =>
        logLogisticSurvival(t, Math.max(0.01, p[0]!), Math.max(0.1, p[1]!)),
      ),
    [medianTime, 1.5],
  );

  const alpha = Math.max(0.01, opt[0]!);
  const beta = Math.max(0.1, opt[1]!);
  const ll = logLikelihood(data, (t) => logLogisticSurvival(t, alpha, beta));
  const k = 2;
  const n = data.length;

  return {
    name: "log_logistic",
    params: { alpha, beta },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: (t) => logLogisticSurvival(t, alpha, beta),
    hazard_at: (t) => logLogisticHazard(t, alpha, beta),
    median_survival: alpha,
    mean_survival_restricted: restrictedMean(data, (t) =>
      logLogisticSurvival(t, alpha, beta),
    ),
  };
}

function fitLogNormal(data: KMDataPoint[]): FittedDistribution {
  const medianTime =
    data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;
  const muInit = Math.log(Math.max(0.1, medianTime));

  const opt = nelderMead(
    (p) =>
      -logLikelihood(data, (t) =>
        logNormalSurvival(t, p[0]!, Math.max(0.01, p[1]!)),
      ),
    [muInit, 0.8],
  );

  const mu = opt[0]!;
  const sigma = Math.max(0.01, opt[1]!);
  const ll = logLikelihood(data, (t) => logNormalSurvival(t, mu, sigma));
  const k = 2;
  const n = data.length;

  return {
    name: "log_normal",
    params: { mu, sigma },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: (t) => logNormalSurvival(t, mu, sigma),
    hazard_at: (t) => logNormalHazard(t, mu, sigma),
    median_survival: Math.exp(mu),
    mean_survival_restricted: restrictedMean(data, (t) =>
      logNormalSurvival(t, mu, sigma),
    ),
  };
}

function fitGompertz(data: KMDataPoint[]): FittedDistribution {
  const medianTime =
    data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;
  const rateInit = Math.log(2) / medianTime;

  const opt = nelderMead(
    (p) =>
      -logLikelihood(data, (t) =>
        gompertzSurvival(t, p[0]!, Math.max(1e-6, p[1]!)),
      ),
    [0.01, rateInit],
  );

  const shape = opt[0]!;
  const rate = Math.max(1e-6, opt[1]!);
  const ll = logLikelihood(data, (t) => gompertzSurvival(t, shape, rate));
  const k = 2;
  const n = data.length;

  // Median: solve S(t) = 0.5 numerically
  let median = medianTime;
  for (let t = 0.01; t < medianTime * 5; t += 0.01) {
    if (gompertzSurvival(t, shape, rate) <= 0.5) {
      median = t;
      break;
    }
  }

  return {
    name: "gompertz",
    params: { shape, rate },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: (t) => gompertzSurvival(t, shape, rate),
    hazard_at: (t) => gompertzHazard(t, shape, rate),
    median_survival: median,
    mean_survival_restricted: restrictedMean(data, (t) =>
      gompertzSurvival(t, shape, rate),
    ),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Patient-level event-time MLE (v1.9.0).
//
// True right-censored maximum likelihood: for each (t_i, δ_i) row,
//   contribution = δ_i · log(f(t_i)) + (1 - δ_i) · log(S(t_i))
// where f(t) = h(t) · S(t) is the density.
//
// This is what NICE DSU TSD 14 expects for parametric survival modeling.
// The KM-table path remains supported (for back-compat with literature
// digitization workflows) but is documented as an approximation.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Right-censored MLE log-likelihood given parametric survival + hazard.
 * Uses f(t) = h(t)·S(t). Numerically guarded against log(0).
 */
function logLikelihoodFromEvents(
  events: EventDataPoint[],
  survFn: (t: number) => number,
  hazardFn: (t: number) => number,
): number {
  let ll = 0;
  for (const row of events) {
    const t = row.time;
    const s = Math.max(1e-300, survFn(t));
    if (row.event === 1) {
      // log f(t) = log h(t) + log S(t)
      const h = Math.max(1e-300, hazardFn(t));
      ll += Math.log(h) + Math.log(s);
    } else {
      ll += Math.log(s);
    }
  }
  return ll;
}

/**
 * Median initialiser: empirical median of observed event times (falls
 * back to median of all times when the event rate is very low).
 */
function initialMedian(events: EventDataPoint[]): number {
  const observed = events.filter((e) => e.event === 1).map((e) => e.time);
  const pool = observed.length >= 5 ? observed : events.map((e) => e.time);
  const sorted = [...pool].sort((a, b) => a - b);
  if (sorted.length === 0) return 1;
  return sorted[Math.floor(sorted.length / 2)]!;
}

function fitExponentialFromEvents(
  events: EventDataPoint[],
  kmTable: KMDataPoint[],
): FittedDistribution {
  const m = initialMedian(events);
  const lambdaInit = Math.max(1e-6, Math.log(2) / m);

  const opt = nelderMead(
    (p) =>
      -logLikelihoodFromEvents(
        events,
        (t) => expSurvival(t, Math.max(1e-9, p[0]!)),
        (_t) => Math.max(1e-9, p[0]!),
      ),
    [lambdaInit],
  );
  const lambda = Math.max(1e-9, opt[0]!);
  const ll = logLikelihoodFromEvents(
    events,
    (t) => expSurvival(t, lambda),
    () => lambda,
  );
  const k = 1;
  const n = events.length;
  const survFn = (t: number) => expSurvival(t, lambda);
  return {
    name: "exponential",
    params: { lambda },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: survFn,
    hazard_at: () => lambda,
    median_survival: Math.log(2) / lambda,
    // True restricted mean ∫₀ᵀ S(t)dt up to max observed time, via the
    // KM table built from the same event data. Pre-v1.9.1 returned
    // 1/lambda (the unrestricted mean) — wrong field semantics.
    mean_survival_restricted: restrictedMean(kmTable, survFn),
  };
}

function fitWeibullFromEvents(
  events: EventDataPoint[],
  kmTable: KMDataPoint[],
): FittedDistribution {
  const m = initialMedian(events);
  const scaleInit = Math.max(0.01, m / Math.pow(Math.log(2), 1));
  const opt = nelderMead(
    (p) =>
      -logLikelihoodFromEvents(
        events,
        (t) => weibullSurvival(t, Math.max(0.05, p[0]!), Math.max(0.01, p[1]!)),
        (t) => weibullHazard(t, Math.max(0.05, p[0]!), Math.max(0.01, p[1]!)),
      ),
    [1.0, scaleInit],
    800,
  );
  const shape = Math.max(0.05, opt[0]!);
  const scale = Math.max(0.01, opt[1]!);
  const ll = logLikelihoodFromEvents(
    events,
    (t) => weibullSurvival(t, shape, scale),
    (t) => weibullHazard(t, shape, scale),
  );
  const k = 2;
  const n = events.length;
  const survFn = (t: number) => weibullSurvival(t, shape, scale);
  return {
    name: "weibull",
    params: { shape, scale },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: survFn,
    hazard_at: (t) => weibullHazard(t, shape, scale),
    median_survival: scale * Math.pow(Math.log(2), 1 / shape),
    // True RMST via numerical integration of S(t) over [0, max_observed].
    // Pre-v1.9.1 returned scale·Γ(1+1/shape) = unrestricted mean.
    mean_survival_restricted: restrictedMean(kmTable, survFn),
  };
}

function fitLogLogisticFromEvents(
  events: EventDataPoint[],
  kmTable: KMDataPoint[],
): FittedDistribution {
  const m = initialMedian(events);
  const opt = nelderMead(
    (p) =>
      -logLikelihoodFromEvents(
        events,
        (t) =>
          logLogisticSurvival(t, Math.max(0.01, p[0]!), Math.max(0.1, p[1]!)),
        (t) =>
          logLogisticHazard(t, Math.max(0.01, p[0]!), Math.max(0.1, p[1]!)),
      ),
    [m, 1.5],
    800,
  );
  const alpha = Math.max(0.01, opt[0]!);
  const beta = Math.max(0.1, opt[1]!);
  const ll = logLikelihoodFromEvents(
    events,
    (t) => logLogisticSurvival(t, alpha, beta),
    (t) => logLogisticHazard(t, alpha, beta),
  );
  const k = 2;
  const n = events.length;
  const survFn = (t: number) => logLogisticSurvival(t, alpha, beta);
  return {
    name: "log_logistic",
    params: { alpha, beta },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: survFn,
    hazard_at: (t) => logLogisticHazard(t, alpha, beta),
    median_survival: alpha,
    // True RMST via numerical integration. Pre-v1.9.1 returned alpha
    // (the median, not the mean) as a fallback because the unrestricted
    // mean is undefined for β ≤ 1; restricted mean over [0, T] is
    // always finite and is the correct field semantics.
    mean_survival_restricted: restrictedMean(kmTable, survFn),
  };
}

function fitLogNormalFromEvents(
  events: EventDataPoint[],
  kmTable: KMDataPoint[],
): FittedDistribution {
  const m = initialMedian(events);
  const muInit = Math.log(Math.max(0.01, m));
  const opt = nelderMead(
    (p) =>
      -logLikelihoodFromEvents(
        events,
        (t) => logNormalSurvival(t, p[0]!, Math.max(0.01, p[1]!)),
        (t) => logNormalHazard(t, p[0]!, Math.max(0.01, p[1]!)),
      ),
    [muInit, 0.8],
    800,
  );
  const mu = opt[0]!;
  const sigma = Math.max(0.01, opt[1]!);
  const ll = logLikelihoodFromEvents(
    events,
    (t) => logNormalSurvival(t, mu, sigma),
    (t) => logNormalHazard(t, mu, sigma),
  );
  const k = 2;
  const n = events.length;
  const survFn = (t: number) => logNormalSurvival(t, mu, sigma);
  return {
    name: "log_normal",
    params: { mu, sigma },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: survFn,
    hazard_at: (t) => logNormalHazard(t, mu, sigma),
    median_survival: Math.exp(mu),
    // True RMST. Pre-v1.9.1 returned exp(μ + σ²/2) = unrestricted mean.
    mean_survival_restricted: restrictedMean(kmTable, survFn),
  };
}

function fitGompertzFromEvents(
  events: EventDataPoint[],
  kmTable: KMDataPoint[],
): FittedDistribution {
  const m = initialMedian(events);
  const rateInit = Math.max(1e-6, Math.log(2) / m);
  const opt = nelderMead(
    (p) =>
      -logLikelihoodFromEvents(
        events,
        (t) => gompertzSurvival(t, p[0]!, Math.max(1e-6, p[1]!)),
        (t) => gompertzHazard(t, p[0]!, Math.max(1e-6, p[1]!)),
      ),
    [0.01, rateInit],
    800,
  );
  const shape = opt[0]!;
  const rate = Math.max(1e-6, opt[1]!);
  const ll = logLikelihoodFromEvents(
    events,
    (t) => gompertzSurvival(t, shape, rate),
    (t) => gompertzHazard(t, shape, rate),
  );
  const k = 2;
  const n = events.length;
  // Median: solve S(t) = 0.5 numerically.
  let median = m;
  for (let t = 0.01; t < m * 10; t += 0.01) {
    if (gompertzSurvival(t, shape, rate) <= 0.5) {
      median = t;
      break;
    }
  }
  const survFn = (t: number) => gompertzSurvival(t, shape, rate);
  return {
    name: "gompertz",
    params: { shape, rate },
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + k * Math.log(n),
    log_likelihood: ll,
    survival_at: survFn,
    hazard_at: (t) => gompertzHazard(t, shape, rate),
    median_survival: median,
    // True RMST via numerical integration. Pre-v1.9.1 returned
    // `median × 1.4427` — that's `1/ln(2)`, the *exponential
    // distribution's* mean/median ratio, applied to a Gompertz median.
    // Reviewer caught this: wrong distribution entirely.
    mean_survival_restricted: restrictedMean(kmTable, survFn),
  };
}

/**
 * Stirling's approximation for Γ(x). Used for Weibull RMST. Accurate
 * to ~0.1% for x ≥ 1; we don't need higher precision for restricted
 * mean reporting.
 */
function gammaApprox(x: number): number {
  if (x <= 0) return Number.POSITIVE_INFINITY;
  // Use Lanczos for x > 0.5
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.PI / (Math.sin(Math.PI * x) * gammaApprox(1 - x));
  }
  let xx = x - 1;
  let a = c[0]!;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (xx + i);
  const t = xx + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, xx + 0.5) * Math.exp(-t) * a;
}

/**
 * IPD entry point: fit all 5 distributions to right-censored event-time data.
 */
export function fitSurvivalCurvesFromEventData(
  events: EventDataPoint[],
  timeUnit: string = "months",
): SurvivalFitResult {
  if (events.length < 5) {
    throw new Error(
      "At least 5 patient-level event-data rows required for parametric fitting",
    );
  }
  const sorted = [...events].sort((a, b) => a.time - b.time);

  // Build the KM table FIRST so each fitter can use it for the
  // restricted-mean integration (numerical ∫₀ᵀ S(t)dt up to max
  // observed time, where T = sorted[-1].time). v1.9.1 fix: pre-fix the
  // IPD fitters returned unrestricted means (or in Gompertz's case
  // median × 1/ln(2), an exponential-distribution constant!) labeled
  // as "restricted mean", which propagated wrong RMST → wrong QALY in
  // downstream cost-effectiveness models.
  const kmTable = computeKaplanMeier(sorted);

  const fits: FittedDistribution[] = [
    fitExponentialFromEvents(sorted, kmTable),
    fitWeibullFromEvents(sorted, kmTable),
    fitLogLogisticFromEvents(sorted, kmTable),
    fitLogNormalFromEvents(sorted, kmTable),
    fitGompertzFromEvents(sorted, kmTable),
  ];
  const byAIC = [...fits].sort((a, b) => a.aic - b.aic);
  const byBIC = [...fits].sort((a, b) => a.bic - b.bic);

  // Extrapolations 0..2× max observed time.
  const maxObserved = sorted[sorted.length - 1]!.time;
  const extrapolationTimes: number[] = [];
  for (let t = 0; t <= maxObserved * 2; t += maxObserved / 10) {
    extrapolationTimes.push(Math.round(t * 10) / 10);
  }
  const extrapolations = extrapolationTimes.map((t) => {
    const kmPoint = kmTable.find(
      (d) => Math.abs(d.time - t) < maxObserved / 20,
    );
    return {
      time: t,
      km_observed: kmPoint?.survival,
      exponential: fits[0]!.survival_at(t),
      weibull: fits[1]!.survival_at(t),
      log_logistic: fits[2]!.survival_at(t),
      log_normal: fits[3]!.survival_at(t),
      gompertz: fits[4]!.survival_at(t),
    };
  });

  return {
    fits,
    best_aic: byAIC[0]!,
    best_bic: byBIC[0]!,
    km_data: kmTable,
    time_unit: timeUnit,
    extrapolations,
  };
}

/**
 * Standard Kaplan-Meier estimator from right-censored event data.
 * Used to surface a "KM observed" column alongside extrapolations so
 * the markdown report can show the empirical curve next to each
 * parametric fit.
 */
function computeKaplanMeier(events: EventDataPoint[]): KMDataPoint[] {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const out: KMDataPoint[] = [];
  let nAtRisk = sorted.length;
  let s = 1.0;
  let prevTime = -1;
  let eventsAtTime = 0;
  let censoredAtTime = 0;

  const flushAt = (t: number) => {
    if (eventsAtTime > 0 && nAtRisk > 0) {
      s = s * (1 - eventsAtTime / nAtRisk);
    }
    out.push({
      time: t,
      survival: s,
      n_at_risk: nAtRisk,
      n_events: eventsAtTime,
    });
    nAtRisk -= eventsAtTime + censoredAtTime;
    eventsAtTime = 0;
    censoredAtTime = 0;
  };

  for (const row of sorted) {
    if (prevTime >= 0 && row.time !== prevTime) {
      flushAt(prevTime);
    }
    if (row.event === 1) eventsAtTime++;
    else censoredAtTime++;
    prevTime = row.time;
  }
  if (prevTime >= 0) flushAt(prevTime);
  return out;
}

function restrictedMean(
  data: KMDataPoint[],
  survFn: (t: number) => number,
): number {
  const maxT = data[data.length - 1]!.time;
  const steps = 200;
  const dt = maxT / steps;
  let area = 0;
  for (let i = 0; i < steps; i++) {
    const t1 = i * dt;
    const t2 = (i + 1) * dt;
    area += 0.5 * (survFn(t1) + survFn(t2)) * dt;
  }
  return area;
}

// --- Main fitting function ---

export function fitSurvivalCurves(
  data: KMDataPoint[],
  timeUnit: string = "months",
): SurvivalFitResult {
  if (data.length < 3) {
    throw new Error("At least 3 data points required for curve fitting");
  }

  // Sort by time
  const sorted = [...data].sort((a, b) => a.time - b.time);

  // Fit all distributions
  const fits: FittedDistribution[] = [
    fitExponential(sorted),
    fitWeibull(sorted),
    fitLogLogistic(sorted),
    fitLogNormal(sorted),
    fitGompertz(sorted),
  ];

  // Sort by AIC
  const byAIC = [...fits].sort((a, b) => a.aic - b.aic);
  const byBIC = [...fits].sort((a, b) => a.bic - b.bic);

  // Generate extrapolation table
  const maxObserved = sorted[sorted.length - 1]!.time;
  const extrapolationTimes: number[] = [];
  for (let t = 0; t <= maxObserved * 2; t += maxObserved / 10) {
    extrapolationTimes.push(Math.round(t * 10) / 10);
  }

  const extrapolations = extrapolationTimes.map((t) => {
    const kmPoint = sorted.find((d) => Math.abs(d.time - t) < maxObserved / 20);
    return {
      time: t,
      km_observed: kmPoint?.survival,
      exponential: fits[0]!.survival_at(t),
      weibull: fits[1]!.survival_at(t),
      log_logistic: fits[2]!.survival_at(t),
      log_normal: fits[3]!.survival_at(t),
      gompertz: fits[4]!.survival_at(t),
    };
  });

  return {
    fits,
    best_aic: byAIC[0]!,
    best_bic: byBIC[0]!,
    km_data: sorted,
    time_unit: timeUnit,
    extrapolations,
  };
}
