/**
 * Pure planner for workflow.living_evidence — the end-to-end living-
 * evidence pipeline ("from review to reimbursement"). No I/O and no
 * tool calls: it emits the ordered runbook of tool calls to make, with
 * each step's trigger condition resolved against the supplied signals.
 *
 * The MCP server is stateless, so this names the flow and routes the next
 * actions; the calling agent executes the steps and the host owns
 * persistence + scheduling (the "automatic refresh" loop). See design log #22.
 */

export type PipelineStage = "baseline" | "refresh";

export interface PipelineStep {
  order: number;
  name: string;
  tool: string;
  action: string;
  /** Human-readable trigger condition. */
  condition: string;
  triggered: boolean;
  rationale: string;
}

export interface LivingEvidenceResult {
  stage: PipelineStage;
  intervention: string;
  indication: string;
  steps: PipelineStep[];
  triggered_count: number;
  skipped_count: number;
  next_refresh_note: string;
  warnings: string[];
}

export interface LivingEvidenceInput {
  intervention: string;
  indication: string;
  stage: PipelineStage;
  project_id?: string;
  /** Refresh signals (from literature.living_review / consistency_check). */
  material_change: boolean;
  new_records: number;
  recommended_downstream: string[];
  drifting_claims: string[];
  /** Deliverables in scope, e.g. ["living_gvd","jca_submission","hta_submission","iegp"]. */
  deliverables: string[];
}

const RECO_TOOL_MAP: Record<string, string> = {
  evidence_network: "evidence.network",
  "evidence.network": "evidence.network",
  itc_feasibility: "evidence.itc",
  "evidence.itc": "evidence.itc",
  indirect_comparison: "evidence.indirect",
  "evidence.indirect": "evidence.indirect",
  maic: "workflow.maic",
  cost_effectiveness: "models.cost_effectiveness",
  budget_impact: "models.budget_impact",
};

function baselineSteps(input: LivingEvidenceInput): PipelineStep[] {
  const steps: Array<Omit<PipelineStep, "order" | "triggered">> = [
    {
      name: "Systematic literature search",
      tool: "literature.search",
      action: "Search 44 sources per SLR domain (epi, burden, clinical, economic, adherence)",
      condition: "always",
      rationale: "Populate the living knowledge base with the source evidence.",
    },
    {
      name: "PICO screening",
      tool: "literature.screen",
      action: "PICO-based relevance scoring + study-design classification",
      condition: "always",
      rationale: "Filter the search to the in-scope evidence.",
    },
    {
      name: "Risk of bias",
      tool: "evidence.risk_of_bias",
      action: "RoB 2 / ROBINS-I / AMSTAR-2 with GRADE",
      condition: "always",
      rationale: "Appraise included studies before synthesis.",
    },
    {
      name: "RCT–RWE triangulation",
      tool: "evidence.triangulation",
      action: "Per-outcome concordance of trial vs real-world evidence",
      condition: "always",
      rationale: "Establish where RWE corroborates trials and flag discordance.",
    },
    {
      name: "Comparative effectiveness",
      tool: "evidence.network / evidence.indirect / workflow.maic",
      action: "Build the network, assess feasibility, run ITC/NMA (MAIC/STC if needed)",
      condition: "always",
      rationale: "Indirect comparison vs relevant comparators (PICO simulation).",
    },
    {
      name: "Cost-effectiveness model",
      tool: "models.cost_effectiveness",
      action: "Markov / PartSA with PSA, OWSA, CEAC, EVPPI",
      condition: "always",
      rationale: "AI-assisted economic modelling → ICER per QALY.",
    },
    {
      name: "Budget impact model",
      tool: "models.budget_impact",
      action: "ISPOR-compliant BIA",
      condition: "always",
      rationale: "Payer affordability alongside the CEA.",
    },
    {
      name: "Evidence gap analysis (iEGP)",
      tool: "evidence.gap_analysis",
      action: "Assess domain coverage → prioritised evidence-generation plan",
      condition: "always",
      rationale: "Identify and prioritise residual gaps before deliverables.",
    },
    {
      name: "Register source-of-truth claims",
      tool: "evidence.claim_registry",
      action: "Upsert key figures (ICER, effect estimates, prevalence) into the registry",
      condition: "always",
      rationale: "One living source of truth that feeds every downstream deliverable.",
    },
    {
      name: "Generate deliverables",
      tool: "hta.dossier / jca.pico_scope / hta.workflow",
      action: `Produce: ${input.deliverables.join(", ") || "Living GVD, JCA submission, HTA submissions"}`,
      condition: "always",
      rationale: "Assemble the JCA/HTA deliverables from the knowledge base.",
    },
    {
      name: "Cross-deliverable consistency check",
      tool: "evidence.consistency_check",
      action: "Verify registered claims appear consistently across all deliverables",
      condition: "always",
      rationale: "Catch drift before release (single source of truth enforced).",
    },
    {
      name: "Lock the living protocol",
      tool: "literature.living_review (init)",
      action: "Lock the SLR protocol + baseline records for future delta refreshes",
      condition: "always",
      rationale: "Enable the automatic-refresh loop.",
    },
  ];
  return steps.map((s, i) => ({ order: i + 1, triggered: true, ...s }));
}

function refreshSteps(input: LivingEvidenceInput): PipelineStep[] {
  const material = input.material_change;
  const hasDrift = input.drifting_claims.length > 0;
  const downstreamTools = [
    ...new Set(
      input.recommended_downstream
        .map((r) => RECO_TOOL_MAP[r] ?? r)
        .filter(Boolean),
    ),
  ];

  const raw: Array<Omit<PipelineStep, "order">> = [
    {
      name: "Living review refresh",
      tool: "literature.living_review (refresh)",
      action: "Re-run the locked SLR; compute new/dropped records + material-change flag",
      condition: "always",
      triggered: true,
      rationale: `${input.new_records} new record(s) since baseline; material change: ${material ? "YES" : "no"}.`,
    },
    {
      name: "Re-run affected analyses",
      tool: downstreamTools.length ? downstreamTools.join(" / ") : "evidence.network / evidence.indirect / models.cost_effectiveness",
      action: "Re-run the analyses the new evidence affects",
      condition: "if material_change",
      triggered: material,
      rationale: material
        ? `Material change → re-run ${downstreamTools.length ? downstreamTools.join(", ") : "the recommended downstream analyses"}.`
        : "No material change → analyses unchanged; skip.",
    },
    {
      name: "Update source-of-truth claims",
      tool: "evidence.claim_registry",
      action: "Upsert any figures that changed (status → supersede the old value)",
      condition: "if material_change",
      triggered: material,
      rationale: material
        ? "Refresh the registry so downstream deliverables inherit the new values."
        : "No analysis changes → registry unchanged; skip.",
    },
    {
      name: "Cross-deliverable consistency check",
      tool: "evidence.consistency_check",
      action: "Scan existing deliverables for drift against the (updated) registry",
      condition: "always",
      triggered: true,
      rationale: hasDrift
        ? `Pre-flagged drifting claims: ${input.drifting_claims.join(", ")}.`
        : "Detect any deliverable that no longer matches the registry.",
    },
    {
      name: "Regenerate drifted deliverables",
      tool: "hta.dossier / jca.pico_scope",
      action: "Regenerate only the deliverables whose claims drifted",
      condition: "if drift detected",
      triggered: material || hasDrift,
      rationale:
        material || hasDrift
          ? "Updated values / drift → regenerate the affected deliverables only."
          : "No drift → deliverables remain current; skip.",
    },
    {
      name: "Re-assess gaps (iEGP)",
      tool: "evidence.gap_analysis",
      action: "Recompute readiness and the evidence-generation plan",
      condition: "always",
      triggered: true,
      rationale: "Keep the gap plan current as evidence accrues.",
    },
  ];
  return raw.map((s, i) => ({ ...s, order: i + 1 }));
}

export function planLivingEvidence(
  input: LivingEvidenceInput,
): LivingEvidenceResult {
  const steps =
    input.stage === "baseline" ? baselineSteps(input) : refreshSteps(input);

  const triggered_count = steps.filter((s) => s.triggered).length;
  const skipped_count = steps.length - triggered_count;

  const next_refresh_note =
    "Scheduling is host-owned: the MCP server is stateless. Persist the living_review protocol + baseline records in the web tier and drive the refresh cadence from a scheduler (cron). Re-invoke this tool with stage='refresh' on each cycle.";

  const warnings: string[] = [];
  if (input.stage === "refresh" && !input.material_change && input.drifting_claims.length === 0) {
    warnings.push(
      "No material change and no drift signalled — this refresh is a no-op beyond the living-review delta and a confirmatory consistency check. Re-arm the next cycle.",
    );
  }
  warnings.push(
    "This is a runbook, not an executor — the planner does not call other tools. Execute the triggered steps in order; each emits its own audit trail.",
  );

  return {
    stage: input.stage,
    intervention: input.intervention,
    indication: input.indication,
    steps,
    triggered_count,
    skipped_count,
    next_refresh_note,
    warnings,
  };
}
