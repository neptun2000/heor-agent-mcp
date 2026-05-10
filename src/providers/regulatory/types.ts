/**
 * Types for regulatory.status_check — design log #25.
 *
 * CRITICAL: current_status NEVER equals "not_approved".
 * Primary-source absence ≠ proof of non-approval → use "unknown".
 */

export interface Citation {
  source: string; // "OpenFDA" | "DailyMed" | "EMA EPI"
  url: string;
  fetched_at: string; // ISO timestamp
}

export interface PopulationParsed {
  age_min_years: number | null;
  age_max_years: number | null;
  weight_constraint_kg: number | null;
  sex_constraint: "male_only" | "female_only" | null;
}

export interface ApprovedIndication {
  indication_text_verbatim: string; // ALWAYS non-empty when status="approved"
  indication_parsed?: string;
  population: string; // verbatim from label
  population_parsed: PopulationParsed | null;
  approval_date: string | null; // YYYY-MM or YYYY-MM-DD
  label_revision: string | null;
  region_specific: boolean;
}

export interface BlackBoxWarning {
  heading: string;
  text_verbatim: string;
}

export type RegulatoryStatus =
  | "approved"
  | "approved_with_restrictions"
  | "withdrawn"
  | "under_review"
  | "unknown" // database absence — NEVER "not_approved"
  | "api_error";

export interface RegulatoryStatusResult {
  schema_version: "1.0";
  drug: string;
  drug_normalised_inn: string;
  drug_brand_names: string[];
  region: string;
  indication_filter?: string;
  current_status: RegulatoryStatus;
  approved_indications: ApprovedIndication[];
  black_box_warnings: BlackBoxWarning[];
  rems_required: boolean;
  contraindications: string[];
  recent_label_changes: {
    count_12_months: number;
    last_revision_date: string | null;
    last_revision_summary: string | null;
  };
  source_urls: Citation[];
  data_fetched_at: string;
  data_age_hours: number;
  cache_hit: boolean;
  did_you_mean?: string[];
  api_error?: {
    source: string;
    message: string;
    retry_after_seconds: number;
  };
}

/** Error thrown by OpenFDA/DailyMed when rate-limited or server error occurs */
export interface RegulatoryApiError extends Error {
  retry_after_seconds: number;
  source?: string;
}
