import { assessInconsistency } from "../../src/grade/inconsistency.js";

describe("assessInconsistency — GRADE inconsistency domain", () => {
  describe("zero studies", () => {
    it("returns not_assessable with no downgrade", () => {
      const r = assessInconsistency(0, null);
      expect(r.level).toBe("not_assessable");
      expect(r.downgrade_steps).toBe(0);
    });
  });

  describe("single study (key fix #2)", () => {
    it("returns not_assessable, NOT 'Serious' — single study cannot be inconsistent with itself", () => {
      const r = assessInconsistency(1, null);
      expect(r.level).toBe("not_assessable");
      expect(r.downgrade_steps).toBe(0);
      expect(r.rationale).toMatch(/single study/i);
      expect(r.rationale).toMatch(/imprecision/i);
    });

    it("ignores I² value when k=1 (I² is undefined for single study)", () => {
      const r = assessInconsistency(1, 80);
      expect(r.level).toBe("not_assessable");
    });
  });

  describe("multiple studies, no I² provided", () => {
    it("returns Moderate with no automatic downgrade and recommends manual review", () => {
      const r = assessInconsistency(3, null);
      expect(r.level).toBe("Moderate");
      expect(r.downgrade_steps).toBe(0);
      expect(r.rationale).toMatch(/manual heterogeneity review/i);
    });
  });

  describe("multiple studies with I² (key fix #1 — wire heterogeneity into GRADE)", () => {
    it("I²=15% (low) → Low, no downgrade", () => {
      const r = assessInconsistency(5, 15);
      expect(r.level).toBe("Low");
      expect(r.downgrade_steps).toBe(0);
    });

    it("I²=45% (low-moderate) → Low, no downgrade", () => {
      const r = assessInconsistency(5, 45);
      expect(r.level).toBe("Low");
      expect(r.downgrade_steps).toBe(0);
    });

    it("I²=60% (substantial) → Moderate, 1-step downgrade", () => {
      const r = assessInconsistency(5, 60);
      expect(r.level).toBe("Moderate");
      expect(r.downgrade_steps).toBe(1);
      expect(r.rationale).toMatch(/I²=60%/);
    });

    it("I²=80% (considerable) → Serious, 1-step downgrade", () => {
      const r = assessInconsistency(5, 80);
      expect(r.level).toBe("Serious");
      expect(r.downgrade_steps).toBe(1);
    });

    it("I²=92% (extreme) → Very Serious, 2-step downgrade", () => {
      const r = assessInconsistency(5, 92);
      expect(r.level).toBe("Very Serious");
      expect(r.downgrade_steps).toBe(2);
    });

    it("I²=50% boundary → Moderate (substantial heterogeneity threshold)", () => {
      const r = assessInconsistency(5, 50);
      expect(r.level).toBe("Moderate");
      expect(r.downgrade_steps).toBe(1);
    });

    it("I²=75% boundary → Serious (considerable heterogeneity threshold)", () => {
      const r = assessInconsistency(5, 75);
      expect(r.level).toBe("Serious");
    });

    it("I²=49.9% just below threshold → Low", () => {
      const r = assessInconsistency(5, 49.9);
      expect(r.level).toBe("Low");
    });
  });

  describe("rationale messages cite I² value", () => {
    it("includes the I² percentage in rationale for transparency", () => {
      const r = assessInconsistency(4, 67);
      expect(r.rationale).toMatch(/67%/);
    });
  });
});
