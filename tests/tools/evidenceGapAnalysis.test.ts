/**
 * Tests for evidence.gap_analysis — the iEGP generator.
 */
import {
  handleEvidenceGapAnalysis,
  type IegpResult,
} from "../../src/tools/evidenceGapAnalysis.js";

interface Res {
  content: string;
  iegp: IegpResult;
}

async function run(input: Record<string, unknown>): Promise<Res> {
  return (await handleEvidenceGapAnalysis(input)) as unknown as Res;
}

describe("evidence_gap_analysis — schema", () => {
  it("requires at least one domain", async () => {
    await expect(
      run({ intervention: "x", indication: "y", domains: [] }),
    ).rejects.toThrow(/at least one domain|domains/i);
  });

  it("rejects an unknown domain with did-you-mean", async () => {
    await expect(
      run({
        intervention: "x",
        indication: "y",
        domains: [{ domain: "economics" as never, status: "absent" }],
      }),
    ).rejects.toThrow(/economic_cea|domain/i);
  });

  it("is case-insensitive", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      decision_context: "HTA_PAYER",
      domains: [{ domain: "Economic_CEA", status: "Robust" }],
    });
    expect(r.iegp.readiness_score).toBe(100);
  });
});

describe("evidence_gap_analysis — severity & prioritisation", () => {
  it("escalates an absent decision-critical domain to critical", async () => {
    const r = await run({
      intervention: "fremanezumab",
      indication: "migraine",
      decision_context: "hta_payer",
      domains: [
        { domain: "comparative_effectiveness", status: "absent" },
        { domain: "patient_experience", status: "absent" },
      ],
    });
    const ce = r.iegp.gaps.find((g) => g.domain === "comparative_effectiveness")!;
    const pe = r.iegp.gaps.find((g) => g.domain === "patient_experience")!;
    expect(ce.severity).toBe("critical"); // decision-critical → escalated
    expect(pe.severity).toBe("high"); // not critical for hta → stays high
  });

  it("orders the plan by severity (critical first)", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      decision_context: "hta_payer",
      domains: [
        { domain: "adherence", status: "limited" }, // medium
        { domain: "economic_cea", status: "absent" }, // critical
        { domain: "disease_burden", status: "limited" }, // medium
      ],
    });
    expect(r.iegp.prioritized_plan[0].severity).toBe("critical");
  });

  it("computes a readiness score from robust domains", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      domains: [
        { domain: "clinical_efficacy", status: "robust" },
        { domain: "economic_cea", status: "robust" },
        { domain: "comparative_effectiveness", status: "absent" },
        { domain: "safety", status: "limited" },
      ],
    });
    expect(r.iegp.readiness_score).toBe(50); // 2/4 robust
  });

  it("maps each gap to a recommended activity and tool", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      domains: [{ domain: "comparative_effectiveness", status: "absent" }],
    });
    const g = r.iegp.gaps[0];
    expect(g.tool).toMatch(/evidence\.(network|indirect)|workflow\.maic/);
    expect(g.recommended_activity).toMatch(/indirect|NMA|MAIC/i);
    expect(g.unblocks.length).toBeGreaterThan(0);
  });
});

describe("evidence_gap_analysis — triangulation signals", () => {
  it("folds discordant outcomes into a comparative-effectiveness gap", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      decision_context: "hta_payer",
      domains: [{ domain: "clinical_efficacy", status: "robust" }],
      discordant_outcomes: ["Outcome Z"],
    });
    const disc = r.iegp.gaps.find((g) => g.label === "RCT–RWE discordance")!;
    expect(disc).toBeDefined();
    expect(disc.severity).toBe("critical"); // comparative_effectiveness is critical for hta
  });

  it("flags single-source outcomes as a medium gap", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      domains: [{ domain: "clinical_efficacy", status: "robust" }],
      single_source_outcomes: ["MMD"],
    });
    expect(r.iegp.gaps.some((g) => g.label === "Single-source outcomes")).toBe(true);
  });
});

describe("evidence_gap_analysis — output", () => {
  it("reports submission-ready when all domains robust", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      domains: [
        { domain: "clinical_efficacy", status: "robust" },
        { domain: "economic_cea", status: "robust" },
      ],
    });
    expect(r.iegp.prioritized_plan).toHaveLength(0);
    expect(r.content).toMatch(/submission-ready|No gaps/i);
  });

  it("renders the prioritised plan table", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      domains: [{ domain: "economic_cea", status: "absent" }],
    });
    expect(r.content).toMatch(/Prioritised generation plan/);
    expect(r.content).toMatch(/Integrated Evidence Generation Plan/);
  });
});
