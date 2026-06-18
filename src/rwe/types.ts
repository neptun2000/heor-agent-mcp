/**
 * Types for rwe_method_select — RWE study-design selection.
 *
 * Encodes the RWE-methodology taxonomy (retrospective database analysis,
 * survey, literature review, chart review, social-media listening) as a
 * structured knowledge base, plus the inputs/outputs of the selector.
 *
 * Source matrix: a recognised RWE method-comparison framework (method ×
 * data source × methodology × inclusion criteria × results validity ×
 * decision-making support × common use). See design log #16.
 */

export type RweMethod =
  | "retrospective_database_analysis"
  | "survey"
  | "literature_review"
  | "chart_review"
  | "social_media_listening";

/** Validity tiers, ordered low < moderate < high. */
export type ValidityTier = "low" | "moderate" | "high";

export const VALIDITY_RANK: Record<ValidityTier, number> = {
  low: 1,
  moderate: 2,
  high: 3,
};

export type ResearchObjective =
  | "treatment_effectiveness"
  | "safety_surveillance"
  | "cost_effectiveness"
  | "treatment_patterns"
  | "patient_preferences"
  | "adherence"
  | "disease_epidemiology"
  | "evidence_synthesis"
  | "patient_experience";

export type DataSource =
  | "claims_database"
  | "ehr"
  | "patient_charts"
  | "patient_survey_access"
  | "hcp_survey_access"
  | "published_literature"
  | "social_media";

export type DecisionContext =
  | "hta_payer"
  | "regulatory"
  | "clinical_guideline"
  | "internal_strategy"
  | "exploratory";

/** Required rigour, ordered exploratory < supportive < submission_grade. */
export type RigorRequired = "exploratory" | "supportive" | "submission_grade";

export const RIGOR_RANK: Record<RigorRequired, number> = {
  exploratory: 1,
  supportive: 2,
  submission_grade: 3,
};

/** One row of the RWE-methodology matrix, plus selector metadata. */
export interface RweMethodProfile {
  method: RweMethod;
  label: string;
  /** Matrix column: data sources this method draws on. */
  source: string;
  /** Matrix column: how the method is conducted. */
  methodology: string;
  /** Matrix column: how cases/records are included. */
  inclusion_criteria: string;
  /** Matrix column: results-validity tier + prose. */
  results_validity: ValidityTier;
  results_validity_note: string;
  /** Matrix column: how it supports decision-making. */
  decision_support: string;
  /** Matrix column: typical use cases. */
  common_use: string;
  /** Research objectives this method is well-suited to. */
  objectives: ResearchObjective[];
  /** Data sources required — method is infeasible without at least one. */
  requires_any_data: DataSource[];
  /** Decision contexts where the method is a natural fit. */
  fits_contexts: DecisionContext[];
  /** Other tools in this server that operationalise the method. */
  pairs_with_tools: string[];
}

export interface RankedMethod {
  method: RweMethod;
  label: string;
  score: number;
  feasible: boolean;
  results_validity: ValidityTier;
  rationale: string;
  /** Caveats — e.g. rigour shortfall, missing data, response bias. */
  caveats: string[];
  pairs_with_tools: string[];
}

export interface RweMethodSelection {
  primary: RankedMethod | null;
  alternatives: RankedMethod[];
  /** Methods excluded because the required data is not available. */
  infeasible: RankedMethod[];
  /** Whether the chosen rigour can be met by any feasible method. */
  rigor_satisfiable: boolean;
  advisory_warnings: string[];
}

export interface RweMethodSelectInput {
  research_objective: ResearchObjective;
  available_data: DataSource[];
  decision_context: DecisionContext;
  rigor_required: RigorRequired;
}
