/**
 * Survival Curve Fitting — fit parametric distributions to Kaplan-Meier data.
 *
 * Supports: Exponential, Weibull, Log-logistic, Log-normal, Gompertz.
 * Uses maximum likelihood estimation via Newton-Raphson optimization.
 * Model selection via AIC/BIC.
 *
 * References:
 * - Latimer NR. NICE DSU TSD 14: Survival analysis (2013)
 * - Collett D. Modelling Survival Data in Medical Research (2015)
 */

export interface KMDataPoint {
  time: number; // in months or years (specify in timeUnit)
  survival: number; // proportion surviving (0-1)
  n_at_risk?: number; // optional: patients at risk
  n_events?: number; // optional: events in interval
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
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

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
    const predicted = Math.max(1e-15, Math.min(1 - 1e-15, survFn(data[i]!.time)));

    // Events in this interval
    const nAtRisk = data[i]!.n_at_risk ?? 100;
    const prevSurv = i === 0 ? 1 : data[i - 1]!.survival;
    const events = Math.round((prevSurv - observed) * nAtRisk);
    const censored = Math.max(0, (i === 0 ? nAtRisk : (data[i]!.n_at_risk ?? nAtRisk)) - events);

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
      simplex[n] = fExpanded < fReflected
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
  const medianTime = data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;
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
    mean_survival_restricted: restrictedMean(data, (t) => expSurvival(t, lambda)),
  };
}

function fitWeibull(data: KMDataPoint[]): FittedDistribution {
  const medianTime = data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;
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
    mean_survival_restricted: restrictedMean(data, (t) => weibullSurvival(t, shape, scale)),
  };
}

function fitLogLogistic(data: KMDataPoint[]): FittedDistribution {
  const medianTime = data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;

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
    mean_survival_restricted: restrictedMean(data, (t) => logLogisticSurvival(t, alpha, beta)),
  };
}

function fitLogNormal(data: KMDataPoint[]): FittedDistribution {
  const medianTime = data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;
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
    mean_survival_restricted: restrictedMean(data, (t) => logNormalSurvival(t, mu, sigma)),
  };
}

function fitGompertz(data: KMDataPoint[]): FittedDistribution {
  const medianTime = data.find((d) => d.survival <= 0.5)?.time ?? data[data.length - 1]!.time;
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
    mean_survival_restricted: restrictedMean(data, (t) => gompertzSurvival(t, shape, rate)),
  };
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
