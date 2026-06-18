/**
 * Types for evidence.gap_analysis — the integrated Evidence Generation
 * Plan (iEGP) generator.
 *
 * Ingests the current state of the evidence base across HEOR domains
 * (caller-supplied; the tool applies rules, it does not invent coverage),
 * identifies gaps, maps each to a recommended evidence-generation activity
 * + the tool that operationalises it + the deliverable it unblocks, and
 * prioritises. See design log #21.
 */

export type EvidenceDomain =
  | "epidemiology"
  | "disease_burden"
  | "clinical_efficacy"
  | "comparative_effectiveness"
  | "safety"
  | "economic_cea"
  | "budget_impact"
  | "hrqol_utilities"
  | "adherence"
  | "unmet_need"
  | "patient_experience";

/** How good is the current evidence in a domain. */
export type EvidenceStatus = "robust" | "limited" | "absent" | "discordant";

export type GapSeverity = "critical" | "high" | "medium" | "none";

export type DecisionContext =
  | "hta_payer"
  | "jca"
  | "regulatory"
  | "market_access"
  | "internal";

export interface DomainMeta {
  domain: EvidenceDomain;
  label: string;
  /** Recommended generation activity when this domain is a gap. */
  recommended_design: string;
  /** Tool in this server that operationalises the fix. */
  tool: string;
  /** Deliverables this domain feeds. */
  unblocks: string[];
}

export interface DomainInput {
  domain: EvidenceDomain;
  status: EvidenceStatus;
  note?: string;
}

export interface GapItem {
  domain: EvidenceDomain;
  label: string;
  status: EvidenceStatus;
  severity: GapSeverity;
  recommended_activity: string;
  tool: string;
  unblocks: string[];
  rationale: string;
}

export interface IegpResult {
  intervention: string;
  indication: string;
  decision_context: DecisionContext;
  readiness_score: number; // 0–100, % of provided domains that are robust
  gaps: GapItem[];
  prioritized_plan: GapItem[];
  summary: {
    domains_assessed: number;
    robust: number;
    critical: number;
    high: number;
    medium: number;
  };
  warnings: string[];
}

export interface IegpInput {
  intervention: string;
  indication: string;
  decision_context: DecisionContext;
  domains: DomainInput[];
  /** Outcomes flagged discordant by evidence.triangulation. */
  discordant_outcomes: string[];
  /** Outcomes with only one evidence type (RCT-only / RWE-only). */
  single_source_outcomes: string[];
}
