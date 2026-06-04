// heor-agent-mcp/src/governance/scoring.ts
import type { AuditRecord } from "../audit/types.js";

export type Rag = "green" | "amber" | "red" | "insufficient";
export type ProbeAnswer = "yes" | "no" | "partial" | null | undefined;
export type UseCase =
  | "regulatory_submission"
  | "payer_dossier"
  | "internal_analysis"
  | "exploratory";

export interface Scorecard {
  green: number;
  amber: number;
  red: number;
  insufficient: number;
}

export function scoreDimension(answer: ProbeAnswer): Rag {
  switch (answer) {
    case "yes":
      return "green";
    case "partial":
      return "amber";
    case "no":
      return "red";
    default:
      return "insufficient";
  }
}

export function tallyScorecard(rags: Rag[]): Scorecard {
  return {
    green: rags.filter((r) => r === "green").length,
    amber: rags.filter((r) => r === "amber").length,
    red: rags.filter((r) => r === "red").length,
    insufficient: rags.filter((r) => r === "insufficient").length,
  };
}

export function aggregateVerdict(rags: Rag[], useCase: UseCase): string {
  const highStakes =
    useCase === "regulatory_submission" || useCase === "payer_dossier";
  const blocking = highStakes || useCase === "internal_analysis";
  const hasRed = rags.includes("red");
  const hasInsufficient = rags.includes("insufficient");
  const hasAmber = rags.includes("amber");

  if (hasRed) {
    return blocking
      ? "Not submission-ready — material governance gap (Red)"
      : "Governance gaps noted (advisory — exploratory use)";
  }
  if (hasInsufficient) {
    if (highStakes) return "Cannot certify — missing governance evidence";
    if (useCase === "internal_analysis")
      return "Adequate with gaps — missing evidence flagged";
    return "Informational — missing evidence (advisory — exploratory use)";
  }
  if (hasAmber) {
    return useCase === "exploratory"
      ? "Minor gaps (advisory)"
      : "Adequate with gaps — resolve ambers before use";
  }
  return "Strong governance posture";
}

export interface DerivedProbes {
  transparency: ProbeAnswer;
  citation_validation: ProbeAnswer;
  auditability: ProbeAnswer;
}

/**
 * Honestly derive ONLY the dimensions a trace can evidence (1, 2, 6).
 * Human-oversight, PHI, and bias cannot be proven from a trace → caller leaves them null.
 */
export function deriveFromAudit(audit: AuditRecord): DerivedProbes {
  const hasCore = Boolean(audit.tool && audit.timestamp);

  const transparency: ProbeAnswer = hasCore
    ? audit.methodology && audit.methodology.trim().length > 0
      ? "yes"
      : "partial"
    : null;

  const calledValidate = audit.tools_called.some(
    (t) => t.name === "utils.validate_links" || t.name === "validate_links",
  );
  const hasSources = audit.sources_queried.length > 0;
  const citation_validation: ProbeAnswer =
    calledValidate && hasSources ? "yes" : hasSources ? "partial" : "no";

  const auditability: ProbeAnswer =
    audit.timestamp &&
    (audit.tools_called.length > 0 || audit.sources_queried.length > 0)
      ? "yes"
      : audit.timestamp
        ? "partial"
        : null;

  return { transparency, citation_validation, auditability };
}
