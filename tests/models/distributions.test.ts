import {
  betaSample,
  gammaSample,
  logNormalSample,
  createSeededRng,
} from "../../src/models/distributions.js";

describe("distributions", () => {
  describe("createSeededRng", () => {
    it("produces reproducible results with same seed", () => {
      const rng1 = createSeededRng(42);
      const rng2 = createSeededRng(42);
      const samples1 = Array.from({ length: 10 }, () => rng1());
      const samples2 = Array.from({ length: 10 }, () => rng2());
      expect(samples1).toEqual(samples2);
    });

    it("produces values in [0, 1)", () => {
      const rng = createSeededRng(99);
      for (let i = 0; i < 100; i++) {
        const v = rng();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it("produces different results with different seeds", () => {
      const rng1 = createSeededRng(1);
      const rng2 = createSeededRng(2);
      const s1 = rng1();
      const s2 = rng2();
      expect(s1).not.toEqual(s2);
    });
  });

  describe("betaSample", () => {
    it("produces values in [0, 1]", () => {
      const rng = createSeededRng(42);
      for (let i = 0; i < 50; i++) {
        const v = betaSample(0.7, 0.01, rng);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it("samples are clamped to [0.001, 0.999]", () => {
      const rng = createSeededRng(42);
      for (let i = 0; i < 50; i++) {
        const v = betaSample(0.5, 0.001, rng);
        expect(v).toBeGreaterThanOrEqual(0.001);
        expect(v).toBeLessThanOrEqual(0.999);
      }
    });

    it("mean is approximately correct", () => {
      const rng = createSeededRng(100);
      const mean = 0.7;
      const variance = 0.005;
      const samples = Array.from({ length: 1000 }, () => betaSample(mean, variance, rng));
      const empiricalMean = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(empiricalMean).toBeCloseTo(mean, 1);
    });
  });

  describe("gammaSample", () => {
    it("produces positive values", () => {
      const rng = createSeededRng(42);
      for (let i = 0; i < 50; i++) {
        const v = gammaSample(1000, 10000, rng);
        expect(v).toBeGreaterThan(0);
      }
    });

    it("mean is approximately correct", () => {
      const rng = createSeededRng(200);
      const mean = 500;
      const variance = 2500;
      const samples = Array.from({ length: 1000 }, () => gammaSample(mean, variance, rng));
      const empiricalMean = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(empiricalMean).toBeCloseTo(mean, -1); // within order of magnitude
      expect(Math.abs(empiricalMean - mean) / mean).toBeLessThan(0.15);
    });
  });

  describe("logNormalSample", () => {
    it("produces positive values", () => {
      const rng = createSeededRng(42);
      for (let i = 0; i < 50; i++) {
        const v = logNormalSample(2.0, 0.5, rng);
        expect(v).toBeGreaterThan(0);
      }
    });

    it("mean is approximately correct", () => {
      const rng = createSeededRng(300);
      const mean = 2.0;
      const variance = 0.1;
      const samples = Array.from({ length: 1000 }, () => logNormalSample(mean, variance, rng));
      const empiricalMean = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(Math.abs(empiricalMean - mean) / mean).toBeLessThan(0.2);
    });
  });
});
