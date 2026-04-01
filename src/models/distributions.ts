/**
 * Pure functions for sampling from statistical distributions (used in PSA Monte Carlo).
 * All functions use method of moments parameterization: convert mean/variance to distribution params.
 */

/**
 * Simple LCG (Linear Congruential Generator) seeded RNG.
 * Returns values in [0, 1).
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0; // ensure unsigned 32-bit int
  return function () {
    // LCG parameters from Numerical Recipes
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Box-Muller transform: produces a standard normal sample from two uniform samples.
 */
function boxMullerNormal(rng: () => number): number {
  let u1 = rng();
  let u2 = rng();
  // Guard against log(0)
  while (u1 === 0) u1 = rng();
  while (u2 === 0) u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Beta distribution sample using method of moments.
 * Mean and variance parameterize Beta(alpha, beta).
 * Output clamped to [0.001, 0.999].
 */
export function betaSample(mean: number, variance: number, rng: () => number): number {
  // Method of moments
  const factor = mean * (1 - mean) / variance - 1;
  const alpha = mean * factor;
  const beta = (1 - mean) * factor;

  // Sample Beta via Gamma ratio: Beta = Gamma(alpha) / (Gamma(alpha) + Gamma(beta))
  const x = gammaSampleShape(alpha, 1, rng);
  const y = gammaSampleShape(beta, 1, rng);
  const result = x / (x + y);

  return Math.max(0.001, Math.min(0.999, result));
}

/**
 * Gamma distribution sample using Marsaglia-Tsang method.
 * shape >= 1 case — returns Gamma(shape, scale=1) sample.
 */
function gammaSampleShape(shape: number, _scale: number, rng: () => number): number {
  if (shape < 1) {
    // Boost: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
    const u = rng();
    return gammaSampleShape(shape + 1, 1, rng) * Math.pow(u, 1 / shape);
  }

  // Marsaglia-Tsang
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x: number;
    let v: number;
    do {
      x = boxMullerNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng();

    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Gamma distribution sample using method of moments.
 * shape = mean^2/variance, scale = variance/mean
 * Returns positive value.
 */
export function gammaSample(mean: number, variance: number, rng: () => number): number {
  const shape = (mean * mean) / variance;
  const scale = variance / mean;
  return gammaSampleShape(shape, 1, rng) * scale;
}

/**
 * Log-Normal distribution sample using method of moments.
 * params on log scale derived from mean/variance.
 * Returns positive value.
 */
export function logNormalSample(mean: number, variance: number, rng: () => number): number {
  // Log-scale parameters
  const sigmaSquared = Math.log(1 + variance / (mean * mean));
  const mu = Math.log(mean) - sigmaSquared / 2;
  const sigma = Math.sqrt(sigmaSquared);

  const z = boxMullerNormal(rng);
  return Math.exp(mu + sigma * z);
}
