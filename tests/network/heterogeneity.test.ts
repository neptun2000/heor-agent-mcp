import {
  computeHeterogeneity,
  cochranQ,
  iSquared,
  tauSquared,
  chiSquaredPValue,
} from "../../src/network/heterogeneity.js";

describe("heterogeneity statistics", () => {
  describe("cochranQ", () => {
    it("is ~0 when all studies agree perfectly", () => {
      const { q, df } = cochranQ([
        { estimate: 0.5, se: 0.1 },
        { estimate: 0.5, se: 0.1 },
        { estimate: 0.5, se: 0.1 },
      ]);
      expect(q).toBeCloseTo(0, 6);
      expect(df).toBe(2);
    });

    it("increases with study disagreement", () => {
      const low = cochranQ([
        { estimate: 0.5, se: 0.1 },
        { estimate: 0.51, se: 0.1 },
      ]);
      const high = cochranQ([
        { estimate: 0.5, se: 0.1 },
        { estimate: 1.5, se: 0.1 },
      ]);
      expect(high.q).toBeGreaterThan(low.q);
    });

    it("returns df 0 for a single study", () => {
      const { df } = cochranQ([{ estimate: 0.5, se: 0.1 }]);
      expect(df).toBe(0);
    });
  });

  describe("iSquared", () => {
    it("is 0 when Q <= df", () => {
      expect(iSquared(1, 5)).toBe(0);
      expect(iSquared(5, 5)).toBe(0);
    });

    it("uses the Higgins formula", () => {
      // Q=20, df=5 → I² = 100 * (20-5)/20 = 75%
      expect(iSquared(20, 5)).toBeCloseTo(75, 3);
    });
  });

  describe("tauSquared", () => {
    it("is 0 when Q <= df", () => {
      const effects = [
        { estimate: 0.5, se: 0.1 },
        { estimate: 0.51, se: 0.1 },
      ];
      expect(tauSquared(effects, 0.01, 1)).toBe(0);
    });

    it("is positive when there is excess variation", () => {
      const effects = [
        { estimate: 0.2, se: 0.1 },
        { estimate: 0.6, se: 0.1 },
        { estimate: 1.0, se: 0.1 },
      ];
      const { q, df } = cochranQ(effects);
      expect(tauSquared(effects, q, df)).toBeGreaterThan(0);
    });
  });

  describe("chiSquaredPValue", () => {
    it("returns ~1 when Q is near 0", () => {
      expect(chiSquaredPValue(0.01, 5)).toBeGreaterThan(0.99);
    });

    it("returns a small p when Q is large relative to df", () => {
      // Q=20, df=5 → p ≈ 0.0012
      const p = chiSquaredPValue(20, 5);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(0.01);
    });

    it("matches known value: Q=7.815, df=3 → p ≈ 0.05", () => {
      const p = chiSquaredPValue(7.815, 3);
      expect(p).toBeGreaterThan(0.04);
      expect(p).toBeLessThan(0.06);
    });
  });

  describe("computeHeterogeneity", () => {
    it("handles fewer than 2 studies gracefully", () => {
      const r = computeHeterogeneity([{ estimate: 0.5, se: 0.1 }]);
      expect(r.n_studies).toBe(1);
      expect(r.cochran_q).toBe(0);
      expect(r.interpretation).toBe("might_not_be_important");
      expect(r.interpretation_band).toContain("insufficient");
    });

    it("returns the full summary for homogeneous studies", () => {
      const r = computeHeterogeneity([
        { estimate: 0.5, se: 0.1 },
        { estimate: 0.52, se: 0.1 },
        { estimate: 0.48, se: 0.1 },
      ]);
      expect(r.n_studies).toBe(3);
      expect(r.df).toBe(2);
      expect(r.i_squared_pct).toBeLessThan(30);
      expect(r.interpretation).toBe("might_not_be_important");
      expect(r.p_value).toBeGreaterThan(0.5);
    });

    it("flags substantial heterogeneity when studies disagree", () => {
      const r = computeHeterogeneity([
        { estimate: 0.1, se: 0.1 },
        { estimate: 1.0, se: 0.1 },
        { estimate: 1.5, se: 0.1 },
        { estimate: 2.0, se: 0.1 },
      ]);
      expect(r.i_squared_pct).toBeGreaterThan(75);
      expect(["substantial", "considerable"]).toContain(r.interpretation);
      expect(r.p_value).toBeLessThan(0.01);
    });

    it("interpretation band text includes percentage range", () => {
      const r = computeHeterogeneity([
        { estimate: 0.1, se: 0.1 },
        { estimate: 2.0, se: 0.1 },
      ]);
      expect(r.interpretation_band).toMatch(/%/);
    });
  });
});
