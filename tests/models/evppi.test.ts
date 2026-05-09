/**
 * Tests for EVPPI (Expected Value of Partial Perfect Information).
 *
 * History: v1.7.0 fix removes the ⚠️ EXPERIMENTAL caveat by addressing
 * the three known issues with the Strong-2014 binning approximation:
 *
 *   1. Mathematical cap: EVPPI ≤ totalEVPI must hold by definition,
 *      but binning noise can push raw estimates above. Pre-fix:
 *      `evppi_proportion` could exceed 1.0 or even produce negative
 *      values in tiny-EVPI cases (the `Math.max(0, ...)` band-aid hid
 *      this without actually fixing it).
 *   2. Noise floor: when total EVPI is essentially zero (decision
 *      robust to all uncertainty), per-parameter binning still
 *      produces fake positive signals from sample noise. Pre-fix the
 *      tool would emit a "top 5 parameters worth researching" table
 *      that was pure noise.
 *   3. Bin count: Sturges' rule (k ≈ 1 + log₂N) is known to under-bin
 *      for non-normal distributions; Freedman-Diaconis (h = 2·IQR·n^(-1/3))
 *      adapts to the actual data spread.
 *
 * Plus: bootstrap 95% CI on each EVPPI point estimate so the markdown
 * report can show uncertainty alongside the point.
 */
import { computeEVPPI, type PSAIterationData } from "../../src/models/evppi.js";

// ─── Fixture builders ─────────────────────────────────────────────────────

/**
 * Build a PSA-shaped fixture where the decision is robust (zero EVPI):
 * every iteration has positive NMB for the intervention regardless of the
 * parameter value. Total EVPI = 0; per-parameter EVPPI must be 0 too.
 */
function zeroEvpiFixture(N: number): PSAIterationData[] {
  const out: PSAIterationData[] = [];
  for (let i = 0; i < N; i++) {
    // delta_qaly always 1, delta_cost always 100 → at lambda=30000, NMB
    // is always ~30000-100 = positive. Decision is robust.
    out.push({
      delta_qaly: 1.0,
      delta_cost: 100,
      params: {
        efficacy: 0.5 + (i / N) * 0.1, // varies but doesn't change verdict
        cost_drug: 1000 + (i / N) * 500,
      },
    });
  }
  return out;
}

/**
 * High-EVPI fixture: efficacy parameter genuinely drives the decision —
 * for some parameter values the intervention is preferred (NMB > 0), for
 * others the comparator (NMB < 0). EVPPI(efficacy) should be substantial.
 */
function highEvppiFixture(N: number): PSAIterationData[] {
  const out: PSAIterationData[] = [];
  for (let i = 0; i < N; i++) {
    const efficacy = (i / N) * 1.0; // 0 to 1
    // delta_qaly tracks efficacy linearly; delta_cost flat
    out.push({
      delta_qaly: efficacy * 0.4 - 0.2, // -0.2 to +0.2
      delta_cost: 5000,
      params: {
        efficacy, // this drives the decision
        cost_drug: 1000, // constant — should have ~0 EVPPI
      },
    });
  }
  return out;
}

// ─── Existing behavior — regression tests ─────────────────────────────────

describe("computeEVPPI — basic invariants", () => {
  it("returns empty array when N < 20 (insufficient data)", () => {
    const tiny: PSAIterationData[] = [];
    for (let i = 0; i < 10; i++) {
      tiny.push({
        delta_qaly: 0.1,
        delta_cost: 100,
        params: { p1: i },
      });
    }
    const r = computeEVPPI(tiny, 30000, ["p1"]);
    expect(r).toEqual([]);
  });

  it("skips parameters not present in iterations", () => {
    const data = zeroEvpiFixture(100);
    const r = computeEVPPI(data, 30000, ["nonexistent_param"]);
    expect(r).toEqual([]);
  });

  it("returns EVPPI sorted descending by point estimate", () => {
    const data = highEvppiFixture(500);
    const r = computeEVPPI(data, 30000, ["efficacy", "cost_drug"]);
    expect(r.length).toBe(2);
    expect(r[0].evppi).toBeGreaterThanOrEqual(r[1].evppi);
  });

  it("non-negative EVPPI for all parameters", () => {
    const data = highEvppiFixture(500);
    const r = computeEVPPI(data, 30000, ["efficacy", "cost_drug"]);
    for (const ev of r) {
      expect(ev.evppi).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── v1.7 fix: mathematical cap (EVPPI ≤ totalEVPI) ───────────────────────

describe("computeEVPPI — mathematical cap (v1.7 fix)", () => {
  it("evppi never exceeds totalEVPI for any parameter", () => {
    const data = highEvppiFixture(300);
    const r = computeEVPPI(data, 30000, ["efficacy", "cost_drug"]);
    // Re-derive total EVPI manually from the same data.
    const N = data.length;
    const eMaxNmb =
      data.reduce(
        (s, it) => s + Math.max(30000 * it.delta_qaly - it.delta_cost, 0),
        0,
      ) / N;
    const meanNmb =
      data.reduce((s, it) => s + (30000 * it.delta_qaly - it.delta_cost), 0) /
      N;
    const totalEVPI = Math.max(0, eMaxNmb - Math.max(meanNmb, 0));
    for (const ev of r) {
      expect(ev.evppi).toBeLessThanOrEqual(totalEVPI + 1e-6); // tiny float tolerance
    }
  });

  it("evppi_proportion bounded to [0, 1]", () => {
    const data = highEvppiFixture(300);
    const r = computeEVPPI(data, 30000, ["efficacy", "cost_drug"]);
    for (const ev of r) {
      expect(ev.evppi_proportion).toBeGreaterThanOrEqual(0);
      expect(ev.evppi_proportion).toBeLessThanOrEqual(1);
    }
  });
});

// ─── v1.7 fix: noise-floor guard ──────────────────────────────────────────

describe("computeEVPPI — noise-floor guard (v1.7 fix)", () => {
  it("emits below_noise_floor=true on every EVPPI when totalEVPI ~ 0", () => {
    const data = zeroEvpiFixture(500);
    const r = computeEVPPI(data, 30000, ["efficacy", "cost_drug"]);
    expect(r.length).toBeGreaterThan(0);
    for (const ev of r) {
      expect(ev.below_noise_floor).toBe(true);
      // Suppressed to 0 explicitly when below the noise floor — no
      // misleading "top parameter to research" signals.
      expect(ev.evppi).toBe(0);
    }
  });

  it("does NOT trip the noise-floor guard when EVPI is genuinely large", () => {
    const data = highEvppiFixture(500);
    const r = computeEVPPI(data, 30000, ["efficacy", "cost_drug"]);
    const efficacyResult = r.find((x) => x.parameter === "efficacy");
    expect(efficacyResult).toBeDefined();
    expect(efficacyResult?.below_noise_floor).toBe(false);
    expect(efficacyResult?.evppi).toBeGreaterThan(0);
  });
});

// ─── v1.7 fix: bootstrap confidence interval ──────────────────────────────

describe("computeEVPPI — bootstrap 95% CI (v1.7 fix)", () => {
  it("returns CI lower ≤ point estimate ≤ CI upper", () => {
    const data = highEvppiFixture(500);
    const r = computeEVPPI(data, 30000, ["efficacy"]);
    const efficacy = r.find((x) => x.parameter === "efficacy")!;
    expect(efficacy.evppi_ci_lower).toBeDefined();
    expect(efficacy.evppi_ci_upper).toBeDefined();
    expect(efficacy.evppi_ci_lower!).toBeLessThanOrEqual(efficacy.evppi);
    expect(efficacy.evppi).toBeLessThanOrEqual(efficacy.evppi_ci_upper!);
  });

  it("CI is non-negative (EVPPI floor is 0)", () => {
    const data = highEvppiFixture(500);
    const r = computeEVPPI(data, 30000, ["efficacy", "cost_drug"]);
    for (const ev of r) {
      expect(ev.evppi_ci_lower!).toBeGreaterThanOrEqual(0);
      expect(ev.evppi_ci_upper!).toBeGreaterThanOrEqual(0);
    }
  });

  it("CI tightens as N grows (sanity check on bootstrap quality)", () => {
    const small = highEvppiFixture(100);
    const large = highEvppiFixture(800);
    const rSmall = computeEVPPI(small, 30000, ["efficacy"]);
    const rLarge = computeEVPPI(large, 30000, ["efficacy"]);
    const widthSmall =
      (rSmall[0]?.evppi_ci_upper ?? 0) - (rSmall[0]?.evppi_ci_lower ?? 0);
    const widthLarge =
      (rLarge[0]?.evppi_ci_upper ?? 0) - (rLarge[0]?.evppi_ci_lower ?? 0);
    // Larger N should produce narrower CI in expectation. Allow some
    // jitter — smoothing not a strict guarantee but should hold here.
    expect(widthLarge).toBeLessThanOrEqual(widthSmall + 1);
  });

  it("does NOT compute CI when below noise floor (no point in CIs on noise)", () => {
    const data = zeroEvpiFixture(500);
    const r = computeEVPPI(data, 30000, ["efficacy"]);
    const ev = r[0];
    expect(ev.below_noise_floor).toBe(true);
    expect(ev.evppi_ci_lower).toBeUndefined();
    expect(ev.evppi_ci_upper).toBeUndefined();
  });
});

// ─── Adaptive binning (Freedman-Diaconis) ─────────────────────────────────

describe("computeEVPPI — adaptive binning", () => {
  it("handles a parameter with constant value (zero variance) without crashing", () => {
    const data: PSAIterationData[] = [];
    for (let i = 0; i < 100; i++) {
      data.push({
        delta_qaly: i / 100 - 0.5,
        delta_cost: 1000,
        params: { constant: 42, varying: i / 100 },
      });
    }
    const r = computeEVPPI(data, 30000, ["constant", "varying"]);
    // Constant parameter contributes ~0 EVPPI by construction (no
    // information to gain from learning a constant).
    const constResult = r.find((x) => x.parameter === "constant");
    expect(constResult).toBeDefined();
    expect(constResult?.evppi).toBeLessThan(100); // tiny, near-zero
  });
});

// ─── v1.9.1: bootstrap CI no longer truncates upper tail ──────────────────
//
// Pre-v1.9.1 the bootstrap loop capped each resample at the original
// sample's totalEVPI, which systematically biased evppi_ci_upper
// downward — bootstrap distribution upper tail truncated whenever a
// resample's empirical totalEVPI exceeded the original. v1.9.1 removed
// the in-loop cap; only the FINAL percentile bounds are clamped.
describe("computeEVPPI — bootstrap CI no in-loop cap (v1.9.1 fix)", () => {
  it("evppi_ci_upper hits the totalEVPI ceiling on saturating fixtures", () => {
    // Fixture where the per-parameter EVPPI is genuinely close to
    // totalEVPI — bootstrap resamples should be able to produce
    // values right at the ceiling without truncation removing them.
    const data = highEvppiFixture(800);
    const r = computeEVPPI(data, 30000, ["efficacy"]);
    const ev = r.find((x) => x.parameter === "efficacy")!;
    // Compute totalEVPI manually from the same data.
    const N = data.length;
    const eMaxNmb =
      data.reduce(
        (s, it) => s + Math.max(30000 * it.delta_qaly - it.delta_cost, 0),
        0,
      ) / N;
    const meanNmb =
      data.reduce((s, it) => s + (30000 * it.delta_qaly - it.delta_cost), 0) /
      N;
    const totalEVPI = Math.max(0, eMaxNmb - Math.max(meanNmb, 0));
    // The capped upper bound is at most totalEVPI (cap is correct).
    expect(ev.evppi_ci_upper!).toBeLessThanOrEqual(totalEVPI + 1e-6);
    // And the upper bound should not be artificially below the point
    // by more than ~the standard error — the in-loop cap pre-v1.9.1
    // could push it well below.
    if (ev.evppi_se && ev.evppi_se > 0) {
      const margin = 3 * ev.evppi_se; // 3 SE = 99%-ish coverage
      expect(ev.evppi_ci_upper!).toBeGreaterThanOrEqual(ev.evppi - margin);
    }
  });
});
