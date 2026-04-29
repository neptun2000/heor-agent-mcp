import { assessUpgrading } from "../../src/grade/upgrading.js";

describe("assessUpgrading — GRADE upgrading domain (Guyatt 2011)", () => {
  describe("does not apply when starting evidence is High (RCTs)", () => {
    it("returns 0 upgrade steps regardless of effect size when start=High", () => {
      const r = assessUpgrading({
        start_certainty: "High",
        large_effect: "very_large",
        dose_response: true,
        plausible_confounding_toward_null: true,
      });
      expect(r.upgrade_steps).toBe(0);
      expect(r.rationale).toMatch(/already high|RCT|not applicable/i);
    });
  });

  describe("large effect (Low → +1 or +2)", () => {
    it("returns +1 for large effect (RR < 0.5 or > 2.0)", () => {
      const r = assessUpgrading({
        start_certainty: "Low",
        large_effect: "large",
      });
      expect(r.upgrade_steps).toBe(1);
      expect(r.rationale).toMatch(/large effect/i);
    });

    it("returns +2 for very large effect (RR < 0.2 or > 5.0)", () => {
      const r = assessUpgrading({
        start_certainty: "Low",
        large_effect: "very_large",
      });
      expect(r.upgrade_steps).toBe(2);
      expect(r.rationale).toMatch(/very large effect/i);
    });

    it("returns 0 when no large effect", () => {
      const r = assessUpgrading({
        start_certainty: "Low",
        large_effect: "none",
      });
      expect(r.upgrade_steps).toBe(0);
    });
  });

  describe("dose-response gradient", () => {
    it("adds +1 for documented dose-response", () => {
      const r = assessUpgrading({
        start_certainty: "Low",
        dose_response: true,
      });
      expect(r.upgrade_steps).toBe(1);
      expect(r.rationale).toMatch(/dose-response/i);
    });
  });

  describe("plausible confounding biasing toward null", () => {
    it("adds +1 when confounding would have reduced the observed effect", () => {
      const r = assessUpgrading({
        start_certainty: "Low",
        plausible_confounding_toward_null: true,
      });
      expect(r.upgrade_steps).toBe(1);
      expect(r.rationale).toMatch(/confounding/i);
    });
  });

  describe("multiple criteria — capped at +2", () => {
    it("very_large_effect (+2) + dose_response (+1) caps at +2", () => {
      const r = assessUpgrading({
        start_certainty: "Low",
        large_effect: "very_large",
        dose_response: true,
      });
      expect(r.upgrade_steps).toBe(2);
    });

    it("large (+1) + dose_response (+1) + confounding (+1) caps at +2", () => {
      const r = assessUpgrading({
        start_certainty: "Low",
        large_effect: "large",
        dose_response: true,
        plausible_confounding_toward_null: true,
      });
      expect(r.upgrade_steps).toBe(2);
    });
  });

  describe("rationale always lists which criteria triggered upgrades", () => {
    it("cites all three when all three apply (even if capped)", () => {
      const r = assessUpgrading({
        start_certainty: "Low",
        large_effect: "large",
        dose_response: true,
        plausible_confounding_toward_null: true,
      });
      expect(r.rationale).toMatch(/large effect/i);
      expect(r.rationale).toMatch(/dose-response/i);
      expect(r.rationale).toMatch(/confounding/i);
    });

    it("returns no upgrade when no criteria apply", () => {
      const r = assessUpgrading({ start_certainty: "Low" });
      expect(r.upgrade_steps).toBe(0);
      expect(r.rationale).toMatch(/no upgrading criteria met/i);
    });
  });
});
