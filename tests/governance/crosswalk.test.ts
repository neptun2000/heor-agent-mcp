// heor-agent-mcp/tests/governance/crosswalk.test.ts
import {
  CROSSWALK,
  DIMENSION_ORDER,
  ELEVATE_VERIFIED_DOMAINS,
  UNSCORED_DOMAINS,
} from "../../src/governance/crosswalk.js";

describe("ELEVATE crosswalk", () => {
  it("has all six dimensions in a fixed order", () => {
    expect(DIMENSION_ORDER).toEqual([
      "transparency",
      "citation_validation",
      "human_oversight",
      "phi_data_handling",
      "bias_equity",
      "auditability",
    ]);
  });

  it("every dimension references only real verified ELEVATE domains", () => {
    const verified = new Set<string>(ELEVATE_VERIFIED_DOMAINS);
    for (const key of DIMENSION_ORDER) {
      const entry = CROSSWALK[key];
      expect(entry.elevate_refs.length).toBeGreaterThan(0);
      for (const ref of entry.elevate_refs) {
        expect(verified.has(ref)).toBe(true);
      }
    }
  });

  it("labels human_oversight as a derived (not standalone) ELEVATE mapping", () => {
    expect(CROSSWALK.human_oversight.derivation_note).toMatch(/no standalone/i);
  });

  it("documents the model-evaluation domains it does NOT score", () => {
    // Robustness, Deployment/Efficiency, Calibration are never referenced by any dimension
    const referenced = new Set(
      DIMENSION_ORDER.flatMap((k) => CROSSWALK[k].elevate_refs),
    );
    for (const d of UNSCORED_DOMAINS) {
      expect(referenced.has(d)).toBe(false);
      expect(ELEVATE_VERIFIED_DOMAINS).toContain(d);
    }
  });

  it("gives every dimension a probe question and a remediation", () => {
    for (const key of DIMENSION_ORDER) {
      expect(CROSSWALK[key].probe_question.length).toBeGreaterThan(0);
      expect(CROSSWALK[key].remediation.length).toBeGreaterThan(0);
    }
  });
});
