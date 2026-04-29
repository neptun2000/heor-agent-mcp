import { assessConsistencyConflict } from "../../src/network/consistency.js";

describe("assessConsistencyConflict — Bucher direct/indirect agreement (Bucher 1997, Cochrane Ch. 11)", () => {
  describe("when no direct (head-to-head) evidence exists", () => {
    it("returns no_conflict and notes assumption is untestable", () => {
      const r = assessConsistencyConflict({
        indirect: { value: 0.5, se: 0.2 },
        direct: null,
      });
      expect(r.has_conflict).toBe(false);
      expect(r.severity).toBe("untestable");
      expect(r.rationale).toMatch(
        /no head-to-head|untestable|cannot be tested/i,
      );
    });
  });

  describe("when direct evidence agrees with indirect (within 1.5 × SE_difference)", () => {
    it("indirect=0.5±0.2, direct=0.6±0.2 → no conflict", () => {
      const r = assessConsistencyConflict({
        indirect: { value: 0.5, se: 0.2 },
        direct: { value: 0.6, se: 0.2 },
      });
      expect(r.has_conflict).toBe(false);
      expect(r.severity).toBe("none");
      expect(r.z_difference).toBeLessThan(1.5);
    });

    it("rationale reports the z-statistic and direction", () => {
      const r = assessConsistencyConflict({
        indirect: { value: 0.5, se: 0.2 },
        direct: { value: 0.6, se: 0.2 },
      });
      expect(r.rationale).toMatch(/z\s*=/i);
    });
  });

  describe("when direct disagrees with indirect (≥1.5 × SE_difference, <1.96)", () => {
    it("flags moderate inconsistency", () => {
      // diff = 0.6, SE_diff = sqrt(0.2² + 0.2²) ≈ 0.283, z ≈ 2.12 — actually >1.96
      // Use values for moderate range: diff=0.5, SE_diff=0.283, z≈1.77
      const r = assessConsistencyConflict({
        indirect: { value: 0.0, se: 0.2 },
        direct: { value: 0.5, se: 0.2 },
      });
      expect(r.has_conflict).toBe(true);
      expect(r.severity).toBe("moderate");
      expect(r.z_difference).toBeGreaterThanOrEqual(1.5);
      expect(r.z_difference).toBeLessThan(1.96);
    });
  });

  describe("when direct strongly disagrees (≥1.96 × SE_difference)", () => {
    it("flags substantial inconsistency — Bucher consistency assumption violated", () => {
      // diff=0.8, SE_diff≈0.283, z≈2.83
      const r = assessConsistencyConflict({
        indirect: { value: 0.0, se: 0.2 },
        direct: { value: 0.8, se: 0.2 },
      });
      expect(r.has_conflict).toBe(true);
      expect(r.severity).toBe("substantial");
      expect(r.z_difference).toBeGreaterThanOrEqual(1.96);
      expect(r.rationale).toMatch(/consistency assumption|substantial|violat/i);
    });
  });

  describe("opposite-direction conflict (most concerning)", () => {
    it("flags substantial when indirect favors A and direct favors B significantly", () => {
      const r = assessConsistencyConflict({
        indirect: { value: -0.5, se: 0.15 },
        direct: { value: 0.5, se: 0.15 },
      });
      expect(r.has_conflict).toBe(true);
      expect(r.severity).toBe("substantial");
      expect(r.rationale).toMatch(/opposite|reverse|direction/i);
    });
  });

  describe("return structure", () => {
    it("always returns the difference and SE_diff for transparency", () => {
      const r = assessConsistencyConflict({
        indirect: { value: 0.3, se: 0.15 },
        direct: { value: 0.4, se: 0.2 },
      });
      expect(r).toHaveProperty("difference");
      expect(r).toHaveProperty("se_difference");
      expect(r.difference).toBeCloseTo(0.1, 5); // direct - indirect = 0.4 - 0.3
      expect(r.se_difference).toBeCloseTo(Math.sqrt(0.15 ** 2 + 0.2 ** 2), 5);
    });
  });
});
