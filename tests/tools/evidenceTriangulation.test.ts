/**
 * Tests for evidence.triangulation — per-outcome RCT-vs-RWE concordance.
 *
 * Fixture mirrors a migraine-prevention triangulation: most outcomes
 * concordant, several with a larger real-world effect, responder rates
 * larger in RWE. Pure logic.
 */
import {
  handleEvidenceTriangulation,
  type TriangulationResult,
} from "../../src/tools/evidenceTriangulation.js";

interface Res {
  content: string;
  triangulation: TriangulationResult;
}

async function run(input: Record<string, unknown>): Promise<Res> {
  return (await handleEvidenceTriangulation(input)) as unknown as Res;
}

describe("evidence_triangulation — schema validation", () => {
  it("requires at least one outcome", async () => {
    await expect(
      run({ intervention: "x", indication: "y", outcomes: [] }),
    ).rejects.toThrow(/at least one outcome|outcomes/i);
  });

  it("requires each outcome to have rct or rwe", async () => {
    await expect(
      run({
        intervention: "x",
        indication: "y",
        outcomes: [{ name: "MMD", benefit_direction: "lower_is_better" }],
      }),
    ).rejects.toThrow(/at least one of rct or rwe/i);
  });

  it("rejects an invalid favors value with did-you-mean", async () => {
    await expect(
      run({
        intervention: "x",
        indication: "y",
        outcomes: [
          {
            name: "MMD",
            benefit_direction: "lower_is_better",
            rct: { favors: "drug" as never },
          },
        ],
      }),
    ).rejects.toThrow(/intervention|favors/i);
  });
});

describe("evidence_triangulation — concordance verdicts", () => {
  it("same direction + larger RWE effect (lower-is-better) → concordant_larger_in_rwe", async () => {
    // MMD: lower is better. RCT MD -2.0, RWE MD -4.0 → bigger reduction in RWE.
    const r = await run({
      intervention: "fremanezumab",
      indication: "migraine",
      outcomes: [
        {
          name: "Monthly Migraine Days (MMD)",
          benefit_direction: "lower_is_better",
          rct: { favors: "intervention", effect_estimate: -2.0, effect_measure: "MD" },
          rwe: { favors: "intervention", effect_estimate: -4.0, effect_measure: "MD" },
        },
      ],
    });
    const o = r.triangulation.outcomes[0];
    expect(o.verdict).toBe("concordant_larger_in_rwe");
    expect(o.magnitude).toBe("larger_in_rwe");
    expect(r.triangulation.summary.larger_in_rwe).toBe(1);
  });

  it("same direction + smaller RWE effect → concordant_smaller_in_rwe (efficacy-effectiveness gap)", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      outcomes: [
        {
          name: "MHD",
          benefit_direction: "lower_is_better",
          rct: { favors: "intervention", effect_estimate: -4.0, effect_measure: "MD" },
          rwe: { favors: "intervention", effect_estimate: -2.0, effect_measure: "MD" },
        },
      ],
    });
    expect(r.triangulation.outcomes[0].verdict).toBe(
      "concordant_smaller_in_rwe",
    );
    expect(r.triangulation.outcomes[0].key_message).toMatch(
      /efficacy.{0,3}effectiveness gap/i,
    );
  });

  it("higher-is-better responder rate, larger RWE effect → larger_in_rwe", async () => {
    // Responder rate: higher is better. RR 1.5 (RCT) vs 2.0 (RWE).
    const r = await run({
      intervention: "x",
      indication: "y",
      outcomes: [
        {
          name: "Responder rate ≥50%",
          benefit_direction: "higher_is_better",
          rct: { favors: "intervention", effect_estimate: 1.5, effect_measure: "RR" },
          rwe: { favors: "intervention", effect_estimate: 2.0, effect_measure: "RR" },
        },
      ],
    });
    expect(r.triangulation.outcomes[0].magnitude).toBe("larger_in_rwe");
  });

  it("opposite directions → discordant + warning", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      outcomes: [
        {
          name: "Outcome Z",
          benefit_direction: "higher_is_better",
          rct: { favors: "intervention" },
          rwe: { favors: "comparator" },
        },
      ],
    });
    expect(r.triangulation.outcomes[0].verdict).toBe("discordant");
    expect(r.triangulation.summary.discordant).toBe(1);
    expect(r.triangulation.warnings.join(" ")).toMatch(/discordant/i);
  });

  it("one no_difference, one benefit → partially_concordant", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      outcomes: [
        {
          name: "HIT-6",
          benefit_direction: "lower_is_better",
          rct: { favors: "no_difference" },
          rwe: { favors: "intervention" },
        },
      ],
    });
    expect(r.triangulation.outcomes[0].verdict).toBe("partially_concordant");
  });

  it("single-source outcomes are flagged rct_only / rwe_only", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      outcomes: [
        {
          name: "RCT-only outcome",
          benefit_direction: "lower_is_better",
          rct: { favors: "intervention" },
        },
        {
          name: "RWE-only outcome",
          benefit_direction: "lower_is_better",
          rwe: { favors: "intervention" },
        },
      ],
    });
    const verdicts = r.triangulation.outcomes.map((o) => o.verdict);
    expect(verdicts).toContain("rct_only");
    expect(verdicts).toContain("rwe_only");
    expect(r.triangulation.summary.single_source).toBe(2);
  });

  it("treats estimates within tolerance as similar (concordant, not larger/smaller)", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      magnitude_tolerance: 0.2,
      outcomes: [
        {
          name: "MMD",
          benefit_direction: "lower_is_better",
          rct: { favors: "intervention", effect_estimate: -2.0, effect_measure: "MD" },
          rwe: { favors: "intervention", effect_estimate: -2.2, effect_measure: "MD" },
        },
      ],
    });
    expect(r.triangulation.outcomes[0].magnitude).toBe("similar");
    expect(r.triangulation.outcomes[0].verdict).toBe("concordant");
  });

  it("different effect measures → magnitude not_comparable, directional concordance only", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      outcomes: [
        {
          name: "MMD",
          benefit_direction: "lower_is_better",
          rct: { favors: "intervention", effect_estimate: -2.0, effect_measure: "MD" },
          rwe: { favors: "intervention", effect_estimate: 0.6, effect_measure: "RR" },
        },
      ],
    });
    expect(r.triangulation.outcomes[0].magnitude).toBe("not_comparable");
    expect(r.triangulation.outcomes[0].verdict).toBe("concordant");
  });
});

describe("evidence_triangulation — output", () => {
  it("emits a per-outcome table, key messages, and RWE-complementary framing", async () => {
    const r = await run({
      intervention: "fremanezumab",
      indication: "migraine",
      outcomes: [
        {
          name: "MMD",
          benefit_direction: "lower_is_better",
          rct: {
            favors: "intervention",
            effect_estimate: -2.0,
            effect_measure: "MD",
            summary: "Pooled RCT MD -2.0 days.",
          },
          rwe: {
            favors: "intervention",
            effect_estimate: -4.0,
            effect_measure: "MD",
            summary: "Real-world MD -4.0 days at 12 months.",
          },
        },
      ],
    });
    expect(r.content).toMatch(/Per-outcome concordance/);
    expect(r.content).toMatch(/Key message per outcome/);
    expect(r.content).toMatch(/complementary/i);
    expect(r.content).toMatch(/Real-world MD -4.0 days/);
  });

  it("always carries the RWE-not-a-substitute caveat", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      outcomes: [
        {
          name: "MMD",
          benefit_direction: "lower_is_better",
          rct: { favors: "intervention" },
          rwe: { favors: "intervention" },
        },
      ],
    });
    expect(r.triangulation.warnings.join(" ")).toMatch(
      /complementary to, not a substitute/i,
    );
  });
});
