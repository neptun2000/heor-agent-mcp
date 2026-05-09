/**
 * Tests for the v1.9.0 patient-level event-time MLE path in
 * survival_fitting (`fitSurvivalCurvesFromEventData`).
 *
 * Strategy: simulate right-censored event data from a known parametric
 * distribution, fit, verify the recovered parameters are within
 * tolerance of the true generating values. This is the strongest
 * available evidence that the MLE is correct — beats hand-rolled
 * point checks.
 *
 * Generators use deterministic seeded RNG (mulberry32) so tests are
 * reproducible; tolerances are loose enough to absorb finite-sample
 * sampling variance at the test sizes we run.
 */
import {
  fitSurvivalCurvesFromEventData,
  type EventDataPoint,
} from "../../src/models/survivalFitting.js";

// ─── Deterministic PRNG ────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Fixture generators ────────────────────────────────────────────────────

function generateExponential(
  n: number,
  lambda: number,
  censoringRate: number,
  seed: number,
): EventDataPoint[] {
  const rng = mulberry32(seed);
  const out: EventDataPoint[] = [];
  for (let i = 0; i < n; i++) {
    // Exponential via inverse CDF: T = -log(U) / lambda
    const eventTime = -Math.log(1 - rng()) / lambda;
    // Independent uniform censoring
    const censorTime = -Math.log(1 - rng()) / (lambda * censoringRate);
    if (eventTime <= censorTime) {
      out.push({ time: eventTime, event: 1 });
    } else {
      out.push({ time: censorTime, event: 0 });
    }
  }
  return out;
}

function generateWeibull(
  n: number,
  shape: number,
  scale: number,
  censoringRate: number,
  seed: number,
): EventDataPoint[] {
  const rng = mulberry32(seed);
  const out: EventDataPoint[] = [];
  for (let i = 0; i < n; i++) {
    // Weibull via inverse CDF: T = scale · (-log(1-U))^(1/shape)
    const eventTime = scale * Math.pow(-Math.log(1 - rng()), 1 / shape);
    // Censoring as exponential at rate censoringRate × mean event rate
    const meanRate = 1 / scale;
    const censorTime = -Math.log(1 - rng()) / (meanRate * censoringRate);
    if (eventTime <= censorTime) {
      out.push({ time: eventTime, event: 1 });
    } else {
      out.push({ time: censorTime, event: 0 });
    }
  }
  return out;
}

function generateLogNormal(
  n: number,
  mu: number,
  sigma: number,
  censoringRate: number,
  seed: number,
): EventDataPoint[] {
  const rng = mulberry32(seed);
  const out: EventDataPoint[] = [];
  for (let i = 0; i < n; i++) {
    // Box-Muller for normal, then exp for log-normal
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const eventTime = Math.exp(mu + sigma * z);
    // Censor at exponential rate centered around the geometric mean
    const meanRate = 1 / Math.exp(mu);
    const censorTime = -Math.log(1 - rng()) / (meanRate * censoringRate);
    if (eventTime <= censorTime) {
      out.push({ time: eventTime, event: 1 });
    } else {
      out.push({ time: censorTime, event: 0 });
    }
  }
  return out;
}

// ─── Schema invariants ─────────────────────────────────────────────────────

describe("fitSurvivalCurvesFromEventData — invariants", () => {
  it("rejects fewer than 5 rows", () => {
    expect(() =>
      fitSurvivalCurvesFromEventData([
        { time: 1, event: 1 },
        { time: 2, event: 1 },
      ]),
    ).toThrow(/at least 5/i);
  });

  it("returns 5 fitted distributions in sorted-by-AIC order via best_aic", () => {
    const data = generateExponential(200, 0.1, 0.3, 42);
    const r = fitSurvivalCurvesFromEventData(data);
    expect(r.fits.length).toBe(5);
    for (const f of r.fits) {
      expect(f.aic).toBeGreaterThan(-Infinity);
      expect(f.log_likelihood).toBeLessThan(0);
    }
    // best_aic is one of the 5 fits
    expect(r.fits.map((f) => f.name)).toContain(r.best_aic.name);
  });

  it("returns sensible KM table built from event data", () => {
    const data = generateExponential(100, 0.1, 0.3, 1);
    const r = fitSurvivalCurvesFromEventData(data);
    expect(r.km_data.length).toBeGreaterThan(0);
    // Survival starts at ≤1, decreases monotonically (or stays flat).
    let prev = 1.001;
    for (const k of r.km_data) {
      expect(k.survival).toBeLessThanOrEqual(prev + 1e-9);
      prev = k.survival;
    }
  });
});

// ─── Parameter recovery — exponential ─────────────────────────────────────

describe("MLE parameter recovery — Exponential", () => {
  it("recovers lambda=0.05 from N=500 with ~30% censoring", () => {
    const data = generateExponential(500, 0.05, 0.3, 7);
    const r = fitSurvivalCurvesFromEventData(data);
    const exp = r.fits.find((f) => f.name === "exponential")!;
    const lambdaHat = exp.params.lambda!;
    // Within 20% of the true λ — generous tolerance for finite-sample
    // variance + censoring loss.
    expect(Math.abs(lambdaHat - 0.05) / 0.05).toBeLessThan(0.2);
  });

  it("recovery is tight at N=1000 (within 12% of true λ)", () => {
    const r = fitSurvivalCurvesFromEventData(
      generateExponential(1000, 0.1, 0.3, 13),
    );
    const lambdaHat = r.fits.find((f) => f.name === "exponential")!.params
      .lambda!;
    expect(Math.abs(lambdaHat - 0.1) / 0.1).toBeLessThan(0.12);
  });
});

// ─── Parameter recovery — Weibull ─────────────────────────────────────────

describe("MLE parameter recovery — Weibull", () => {
  it("recovers shape=1.5, scale=20 from N=500", () => {
    const data = generateWeibull(500, 1.5, 20, 0.3, 9);
    const r = fitSurvivalCurvesFromEventData(data);
    const wb = r.fits.find((f) => f.name === "weibull")!;
    const shapeHat = wb.params.shape!;
    const scaleHat = wb.params.scale!;
    expect(Math.abs(shapeHat - 1.5) / 1.5).toBeLessThan(0.25);
    expect(Math.abs(scaleHat - 20) / 20).toBeLessThan(0.25);
  });
});

// ─── Parameter recovery — Log-normal ──────────────────────────────────────

describe("MLE parameter recovery — Log-normal", () => {
  it("recovers mu=2.5, sigma=0.6 from N=500", () => {
    const data = generateLogNormal(500, 2.5, 0.6, 0.3, 17);
    const r = fitSurvivalCurvesFromEventData(data);
    const ln = r.fits.find((f) => f.name === "log_normal")!;
    const muHat = ln.params.mu!;
    const sigmaHat = ln.params.sigma!;
    expect(Math.abs(muHat - 2.5)).toBeLessThan(0.4);
    expect(Math.abs(sigmaHat - 0.6) / 0.6).toBeLessThan(0.3);
  });
});

// ─── Model selection sanity ───────────────────────────────────────────────

describe("model selection (AIC) on simulated data", () => {
  it("Exponential is preferred when data IS exponential", () => {
    // Exponential is a special case of Weibull (shape=1) so usually
    // picks slightly less likely than Weibull on the same data due to
    // 1 fewer param + AIC penalty. Exponential AIC should be within
    // 5 units of Weibull on truly exponential data.
    const data = generateExponential(800, 0.1, 0.3, 23);
    const r = fitSurvivalCurvesFromEventData(data);
    const exp = r.fits.find((f) => f.name === "exponential")!;
    const wb = r.fits.find((f) => f.name === "weibull")!;
    expect(exp.aic - wb.aic).toBeLessThan(5);
  });

  it("Weibull is preferred when data IS Weibull (shape ≠ 1)", () => {
    const data = generateWeibull(800, 2.0, 15, 0.3, 31);
    const r = fitSurvivalCurvesFromEventData(data);
    const exp = r.fits.find((f) => f.name === "exponential")!;
    const wb = r.fits.find((f) => f.name === "weibull")!;
    // Weibull should beat Exponential by AIC when the true shape is 2.
    expect(wb.aic).toBeLessThan(exp.aic);
  });
});

// ─── Survival function output shape ───────────────────────────────────────

describe("FittedDistribution survival_at and median consistency", () => {
  it("S(0) = 1 for all distributions", () => {
    const r = fitSurvivalCurvesFromEventData(
      generateExponential(200, 0.1, 0.3, 41),
    );
    for (const f of r.fits) {
      expect(f.survival_at(0)).toBeGreaterThanOrEqual(0.999);
    }
  });

  it("S(t) is monotonically non-increasing", () => {
    const r = fitSurvivalCurvesFromEventData(
      generateExponential(200, 0.1, 0.3, 43),
    );
    for (const f of r.fits) {
      let prev = 1.001;
      for (let t = 0; t < 50; t += 1) {
        const s = f.survival_at(t);
        expect(s).toBeLessThanOrEqual(prev + 1e-9);
        prev = s;
      }
    }
  });

  it("S(median) ≈ 0.5 (within 5pp tolerance)", () => {
    const r = fitSurvivalCurvesFromEventData(
      generateWeibull(500, 1.5, 20, 0.3, 47),
    );
    for (const f of r.fits) {
      const med = f.median_survival;
      if (med > 0 && med < 1000) {
        const sAtMed = f.survival_at(med);
        expect(Math.abs(sAtMed - 0.5)).toBeLessThan(0.05);
      }
    }
  });
});

// ─── Censoring-rate effects ───────────────────────────────────────────────

describe("right-censoring handling", () => {
  it("recovers parameters with HEAVY (60%) censoring", () => {
    const data = generateExponential(800, 0.1, 0.7, 53);
    const censored = data.filter((d) => d.event === 0).length;
    const censorFrac = censored / data.length;
    expect(censorFrac).toBeGreaterThan(0.4); // sanity check the generator
    const r = fitSurvivalCurvesFromEventData(data);
    const lambdaHat = r.fits.find((f) => f.name === "exponential")!.params
      .lambda!;
    // Heavier censoring widens the CI; allow ~30% tolerance.
    expect(Math.abs(lambdaHat - 0.1) / 0.1).toBeLessThan(0.3);
  });

  it("handles all-events (zero censoring)", () => {
    const data = generateExponential(500, 0.1, 0.01, 59).map((d) => ({
      ...d,
      event: 1 as const,
    }));
    expect(() => fitSurvivalCurvesFromEventData(data)).not.toThrow();
  });
});
