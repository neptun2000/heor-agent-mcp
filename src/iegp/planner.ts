/**
 * Pure iEGP planner. Turns the assessed evidence-base state into a
 * prioritised evidence-generation plan. No I/O.
 *
 * Severity: a gap on a decision-critical domain escalates one tier.
 *   robust    → none
 *   limited   → medium  (critical domain → high)
 *   discordant→ high    (critical domain → critical)
 *   absent    → high    (critical domain → critical)
 */
import { CRITICAL_DOMAINS, DOMAIN_REGISTRY } from "./domainRegistry.js";
import type {
  GapItem,
  GapSeverity,
  IegpInput,
  IegpResult,
} from "./types.js";

const SEVERITY_RANK: Record<GapSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  none: 3,
};

function severityFor(
  status: GapItem["status"],
  isCritical: boolean,
): GapSeverity {
  switch (status) {
    case "robust":
      return "none";
    case "limited":
      return isCritical ? "high" : "medium";
    case "discordant":
    case "absent":
      return isCritical ? "critical" : "high";
  }
}

export function planIegp(input: IegpInput): IegpResult {
  const critical = new Set(CRITICAL_DOMAINS[input.decision_context] ?? []);
  const gaps: GapItem[] = [];
  let robust = 0;

  for (const d of input.domains) {
    if (d.status === "robust") {
      robust++;
      continue;
    }
    const meta = DOMAIN_REGISTRY[d.domain];
    const isCritical = critical.has(d.domain);
    const severity = severityFor(d.status, isCritical);
    const statusText =
      d.status === "absent"
        ? "No usable evidence"
        : d.status === "discordant"
          ? "Conflicting evidence"
          : "Evidence is thin";
    gaps.push({
      domain: d.domain,
      label: meta.label,
      status: d.status,
      severity,
      recommended_activity: meta.recommended_design,
      tool: meta.tool,
      unblocks: meta.unblocks,
      rationale: `${statusText} for ${meta.label.toLowerCase()}${isCritical ? " — decision-critical for this context, so escalated" : ""}.${d.note ? ` ${d.note}` : ""}`,
    });
  }

  // Fold triangulation signals into the clinical / comparative gaps.
  if (input.discordant_outcomes.length > 0) {
    gaps.push({
      domain: "comparative_effectiveness",
      label: "RCT–RWE discordance",
      status: "discordant",
      severity: critical.has("comparative_effectiveness") ? "critical" : "high",
      recommended_activity:
        "Reconcile divergent outcomes: investigate population/comparator/confounding differences; consider an adjusted indirect comparison (MAIC/STC)",
      tool: "evidence.triangulation / workflow.maic",
      unblocks: ["HTA submission", "JCA submission"],
      rationale: `${input.discordant_outcomes.length} outcome(s) discordant between RCT and RWE: ${input.discordant_outcomes.join(", ")}. Do not present as corroborated until reconciled.`,
    });
  }
  if (input.single_source_outcomes.length > 0) {
    gaps.push({
      domain: "clinical_efficacy",
      label: "Single-source outcomes",
      status: "limited",
      severity: "medium",
      recommended_activity:
        "Generate the missing evidence type (real-world corroboration of trial outcomes, or vice versa) to enable triangulation",
      tool: "rwe.method_select / literature.living_review",
      unblocks: ["HTA submission", "Living GVD"],
      rationale: `${input.single_source_outcomes.length} outcome(s) supported by only one evidence type: ${input.single_source_outcomes.join(", ")}.`,
    });
  }

  // Prioritise: severity, then registry order is implied by insertion.
  const prioritized_plan = [...gaps].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  const domains_assessed = input.domains.length;
  const readiness_score =
    domains_assessed > 0 ? Math.round((robust / domains_assessed) * 100) : 0;

  const summary = {
    domains_assessed,
    robust,
    critical: gaps.filter((g) => g.severity === "critical").length,
    high: gaps.filter((g) => g.severity === "high").length,
    medium: gaps.filter((g) => g.severity === "medium").length,
  };

  const warnings: string[] = [];
  if (summary.critical > 0) {
    warnings.push(
      `${summary.critical} critical gap(s) on decision-critical domains — these block a credible ${input.decision_context} submission and should be generated first.`,
    );
  }
  if (domains_assessed === 0) {
    warnings.push(
      "No domains assessed — supply the evidence-base state per domain to generate a plan.",
    );
  }
  warnings.push(
    "Gap severity reflects the caller-supplied evidence status; this tool prioritises and routes — it does not verify the underlying evidence. Confirm each status against the source.",
  );

  return {
    intervention: input.intervention,
    indication: input.indication,
    decision_context: input.decision_context,
    readiness_score,
    gaps,
    prioritized_plan,
    summary,
    warnings,
  };
}
