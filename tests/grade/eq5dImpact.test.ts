import { estimateBaselineAdjustedImpact } from "../../src/grade/eq5dImpact.js";

describe("estimateBaselineAdjustedImpact — Biz 2026 with baseline utility modulation", () => {
  describe("non_cancer_qol_only (median +59%)", () => {
    it("returns the published median when baseline_utility is not provided", () => {
      const r = estimateBaselineAdjustedImpact("non_cancer_qol_only", undefined);
      expect(r.icer_change_pct.point).toBe(59);
      expect(r.is_baseline_adjusted).toBe(false);
    });

    it("MILD condition (baseline=0.85) → ICER increase EXCEEDS median", () => {
      const r = estimateBaselineAdjustedImpact("non_cancer_qol_only", 0.85);
      expect(r.icer_change_pct.point).toBeGreaterThan(59);
      expect(r.is_baseline_adjusted).toBe(true);
      expect(r.rationale).toMatch(/mild|compressed|higher.*baseline/i);
    });

    it("SEVERE condition (baseline=0.45) → ICER increase BELOW median", () => {
      const r = estimateBaselineAdjustedImpact("non_cancer_qol_only", 0.45);
      expect(r.icer_change_pct.point).toBeLessThan(59);
      expect(r.icer_change_pct.point).toBeGreaterThan(0);
    });

    it("baseline ~0.65 (typical of dataset) returns close to published median", () => {
      const r = estimateBaselineAdjustedImpact("non_cancer_qol_only", 0.65);
      expect(Math.abs(r.icer_change_pct.point - 59)).toBeLessThan(15);
    });

    it("returns plausible range (lower < point < upper)", () => {
      const r = estimateBaselineAdjustedImpact("non_cancer_qol_only", 0.85);
      expect(r.icer_change_pct.lower).toBeLessThan(r.icer_change_pct.point);
      expect(r.icer_change_pct.upper).toBeGreaterThan(r.icer_change_pct.point);
    });
  });

  describe("cancer_life_extending (median -12%)", () => {
    it("returns the published median when no baseline utility", () => {
      const r = estimateBaselineAdjustedImpact("cancer_life_extending", undefined);
      expect(r.icer_change_pct.point).toBe(-12);
    });

    it("SEVERE state (baseline=0.40) → ICER decrease GREATER than median", () => {
      const r = estimateBaselineAdjustedImpact("cancer_life_extending", 0.40);
      expect(r.icer_change_pct.point).toBeLessThan(-12);
    });

    it("LESS SEVERE state (baseline=0.75) → smaller ICER decrease", () => {
      const r = estimateBaselineAdjustedImpact("cancer_life_extending", 0.75);
      expect(r.icer_change_pct.point).toBeGreaterThan(-12);
      expect(r.icer_change_pct.point).toBeLessThan(0);
    });
  });

  describe("disclosure & methodology", () => {
    it("baseline-adjusted result must label itself as an extrapolation", () => {
      const r = estimateBaselineAdjustedImpact("non_cancer_qol_only", 0.85);
      expect(r.rationale).toMatch(/extrapolation|approximat|not directly/i);
    });

    it("validates baseline_utility is in [0, 1]", () => {
      expect(() =>
        estimateBaselineAdjustedImpact("non_cancer_qol_only", 1.5),
      ).toThrow(/baseline_utility/);
      expect(() =>
        estimateBaselineAdjustedImpact("non_cancer_qol_only", -0.1),
      ).toThrow(/baseline_utility/);
    });

    it("ignores baseline_utility for mixed-direction non_cancer_life_extending category", () => {
      const r = estimateBaselineAdjustedImpact(
        "non_cancer_life_extending",
        0.85,
      );
      // For the mixed category, modulation is unreliable — return median + warning
      expect(r.is_baseline_adjusted).toBe(false);
      expect(r.rationale).toMatch(/mixed|heterogeneous|cannot.*reliably/i);
    });
  });
});
