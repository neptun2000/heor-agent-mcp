/**
 * Tests for workflow.living_evidence — the pipeline orchestrator.
 */
import {
  handleWorkflowLivingEvidence,
  type LivingEvidenceResult,
} from "../../src/tools/workflowLivingEvidence.js";

interface Res {
  content: string;
  living_evidence: LivingEvidenceResult;
}

async function run(input: Record<string, unknown>): Promise<Res> {
  return (await handleWorkflowLivingEvidence(input)) as unknown as Res;
}

describe("workflow_living_evidence — baseline", () => {
  it("emits the full chain with every step triggered", async () => {
    const r = await run({
      intervention: "fremanezumab",
      indication: "migraine",
      stage: "baseline",
    });
    expect(r.living_evidence.stage).toBe("baseline");
    expect(r.living_evidence.skipped_count).toBe(0);
    expect(r.living_evidence.triggered_count).toBe(r.living_evidence.steps.length);
    const tools = r.living_evidence.steps.map((s) => s.tool).join(" ");
    expect(tools).toMatch(/literature\.search/);
    expect(tools).toMatch(/evidence\.gap_analysis/);
    expect(tools).toMatch(/evidence\.claim_registry/);
    expect(tools).toMatch(/consistency_check/);
    expect(tools).toMatch(/hta\.living_gvd/); // snapshot step wired in
  });

  it("includes the living_review init step to enable refresh", async () => {
    const r = await run({ intervention: "x", indication: "y", stage: "baseline" });
    expect(r.content).toMatch(/living_review.*init|Lock the living protocol/i);
  });
});

describe("workflow_living_evidence — refresh gating", () => {
  it("skips re-run + regenerate when no material change and no drift", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      stage: "refresh",
      material_change: false,
      drifting_claims: [],
    });
    const rerun = r.living_evidence.steps.find((s) => s.name === "Re-run affected analyses")!;
    const regen = r.living_evidence.steps.find((s) => s.name === "Regenerate drifted deliverables")!;
    expect(rerun.triggered).toBe(false);
    expect(regen.triggered).toBe(false);
    // living_review refresh + consistency check + gap re-assess always run
    expect(r.living_evidence.triggered_count).toBeGreaterThanOrEqual(3);
    expect(r.living_evidence.warnings.join(" ")).toMatch(/no-op/i);
  });

  it("triggers re-run and uses the recommended downstream tools on material change", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      stage: "refresh",
      material_change: true,
      new_records: 4,
      recommended_downstream: ["evidence_network", "itc_feasibility"],
    });
    const rerun = r.living_evidence.steps.find((s) => s.name === "Re-run affected analyses")!;
    expect(rerun.triggered).toBe(true);
    expect(rerun.tool).toMatch(/evidence\.network/);
    expect(rerun.tool).toMatch(/evidence\.itc/);
  });

  it("triggers regeneration when claims drift even without material change", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      stage: "refresh",
      material_change: false,
      drifting_claims: ["icer-base"],
    });
    const regen = r.living_evidence.steps.find((s) => s.name === "Regenerate drifted deliverables")!;
    expect(regen.triggered).toBe(true);
  });

  it("always runs the Living GVD section diff on refresh", async () => {
    const r = await run({
      intervention: "x",
      indication: "y",
      stage: "refresh",
      material_change: false,
      drifting_claims: [],
    });
    const diff = r.living_evidence.steps.find((s) => s.name === "Living GVD section diff")!;
    expect(diff).toBeDefined();
    expect(diff.triggered).toBe(true);
    expect(diff.tool).toMatch(/hta\.living_gvd/);
  });
});

describe("workflow_living_evidence — output", () => {
  it("renders a runbook table and the host-owned refresh note", async () => {
    const r = await run({ intervention: "x", indication: "y", stage: "baseline" });
    expect(r.content).toMatch(/Runbook/);
    expect(r.content).toMatch(/Automatic refresh/);
    expect(r.content).toMatch(/host-owned|stateless/i);
  });

  it("notes it is a runbook, not an executor", async () => {
    const r = await run({ intervention: "x", indication: "y", stage: "baseline" });
    expect(r.living_evidence.warnings.join(" ")).toMatch(/runbook, not an executor/i);
  });
});
