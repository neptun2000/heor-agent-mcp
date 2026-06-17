/**
 * Shared types for the cross-deliverable claim layer:
 *   evidence.claim_registry    — author a claim once, reference by ID.
 *   evidence.consistency_check — detect drift of registered claims across
 *                                deliverables (dossier / publication / payer).
 *   publication.draft          — assemble a publication that reuses claims.
 *
 * A "claim" is a single source-of-truth evidence statement (e.g. an ICER,
 * an effect estimate, a prevalence figure) that may appear verbatim in
 * many deliverables. Centralising it makes drift detectable. See design
 * log #20.
 */

export type ClaimStatus = "draft" | "verified" | "superseded";

export interface Claim {
  /** Stable slug used to reference the claim across deliverables. */
  id: string;
  /** Human-readable claim text, e.g. "Base-case ICER is £18,500 per QALY". */
  statement: string;
  /** Canonical numeric value, when the claim is quantitative. */
  numeric_value?: number;
  /** Canonical display form, e.g. "£18,500". */
  value_display?: string;
  /** Unit, e.g. "GBP/QALY", "%", "days". */
  unit?: string;
  /** Anchor terms used by the consistency checker to locate the claim in prose. */
  keywords: string[];
  /** Source citation / provenance. */
  citation?: string;
  /** Originating tool, e.g. "models.cost_effectiveness". */
  source_tool?: string;
  /** Originating run/audit id, for traceability. */
  source_run_id?: string;
  status: ClaimStatus;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ClaimRegistry {
  schema_version: "1.0";
  project_id: string;
  claims: Claim[];
  updated_at: string;
}

// ── Consistency check ──────────────────────────────────────────────────────

export interface DeliverableInput {
  /** Label, e.g. "NICE dossier", "AMCP GVD", "ISPOR abstract". */
  name: string;
  text: string;
}

export type ClaimDeliverableStatus = "consistent" | "drift" | "absent";

export interface ClaimDeliverableFinding {
  claim_id: string;
  deliverable: string;
  status: ClaimDeliverableStatus;
  /** Conflicting numeric strings found near the claim's keywords (drift). */
  conflicting_values: string[];
  note: string;
}

export interface ConsistencyResult {
  claims_checked: number;
  deliverables_checked: number;
  findings: ClaimDeliverableFinding[];
  drift_count: number;
  absent_count: number;
  /** Claim ids with at least one drift finding — the actionable list. */
  drifting_claims: string[];
  warnings: string[];
}

// ── Publication draft ──────────────────────────────────────────────────────

export type PublicationType =
  | "abstract"
  | "manuscript"
  | "poster"
  | "plain_language_summary";

export type StudyDesign =
  | "rct"
  | "observational"
  | "systematic_review"
  | "economic_evaluation"
  | "other";

export interface PublicationSection {
  heading: string;
  body: string;
}

export interface PublicationResult {
  type: PublicationType;
  title: string;
  target?: string;
  sections: PublicationSection[];
  reporting_guideline: string;
  compliance_checklist: { item: string; mandatory: boolean }[];
  word_count: number;
  word_limit: number | null;
  referenced_claims: string[];
  warnings: string[];
}
