import type { AuditRecord } from "../audit/types.js";

export type OutputFormat = "text" | "json" | "docx";
export type HtaBody = "nice" | "ema" | "fda" | "iqwig" | "has" | "jca";
export type SubmissionType =
  | "sta"
  | "mta"
  | "early_access"
  | "initial"
  | "renewal"
  | "variation";
export type DataSource =
  | "pubmed"
  | "clinicaltrials"
  | "biorxiv"
  | "chembl"
  | "embase"
  | "who_gho"
  | "world_bank"
  | "all_of_us"
  | "oecd"
  | "ihme_gbd"
  | "orange_book"
  | "purple_book"
  | "cochrane"
  | "citeline"
  | "pharmapendium"
  | "cortellis"
  | "google_scholar"
  | "cms_nadac"
  | "pssru"
  | "nhs_costs"
  | "bnf"
  | "pbs_schedule"
  | "datasus"
  | "conitec"
  | "anvisa"
  | "paho"
  | "iets"
  | "fonasa"
  | "hitap";
export type StudyType = "rct" | "meta_analysis" | "observational" | "review";
export type TimeHorizon = "lifetime" | "5yr" | "10yr" | number;
export type Perspective = "nhs" | "us_payer" | "societal";

export interface LiteratureResult {
  id: string;
  source: DataSource;
  title: string;
  authors: string[];
  date: string;
  study_type: string;
  abstract: string;
  url: string;
}

export interface LiteratureSearchParams {
  query: string;
  sources?: DataSource[];
  max_results?: number;
  date_from?: string;
  study_types?: StudyType[];
  output_format?: OutputFormat;
  project?: string;
}

export interface CEModelParams {
  intervention: string;
  comparator: string;
  indication: string;
  time_horizon: TimeHorizon;
  perspective: Perspective;
  clinical_inputs: {
    efficacy_delta: number;
    mortality_reduction?: number;
    ae_rate?: number;
  };
  cost_inputs: {
    drug_cost_annual: number;
    admin_cost?: number;
    ae_cost?: number;
    comparator_cost_annual: number;
  };
  utility_inputs?: {
    qaly_on_treatment: number;
    qaly_comparator: number;
  };
  output_format?: OutputFormat;

  // New fields for advanced model selection
  model_type?: "markov" | "partsa" | "decision_tree"; // default "markov"
  states?: string[]; // custom state names for Markov
  run_psa?: boolean; // default true
  psa_iterations?: number; // 1-10000, default 1000
  run_owsa?: boolean; // default true
  parameter_uncertainty?: {
    transition_probabilities?: Record<
      string,
      { mean: number; ci_lower: number; ci_upper: number }
    >;
    utilities?: Record<
      string,
      { mean: number; ci_lower: number; ci_upper: number }
    >;
    costs?: Record<string, { mean: number; sd: number }>;
  };

  project?: string;

  // PartSA fields (used when model_type === "partsa")
  survival_inputs?: {
    os_median_months?: number;
    pfs_median_months?: number;
    os_median_months_comparator?: number;
    pfs_median_months_comparator?: number;
    survival_distribution?: "exponential" | "weibull";
    weibull_shape?: number;
  };
}

export interface PicoDefinition {
  id: string; // e.g. "PICO-1"
  population: string; // specific subpopulation
  comparator: string; // comparator for this PICO
  outcomes: string[]; // relevant outcomes for this PICO
}

export interface DossierParams {
  hta_body: HtaBody;
  submission_type: SubmissionType;
  drug_name: string;
  indication: string;
  evidence_summary?: string | LiteratureResult[];
  model_results?: CEModelResult;
  output_format?: OutputFormat;
  picos?: PicoDefinition[]; // JCA: list of PICOs. If omitted, single default PICO is generated.
  project?: string;
}

export interface ToolResult {
  content: string | object;
  audit: AuditRecord;
}

export interface WTPAssessment {
  threshold_low: number;
  threshold_high: number;
  currency: string;
  symbol: string;
  verdict: "cost_effective" | "borderline" | "not_cost_effective" | "dominated";
}

export interface PSASummary {
  iterations: number;
  mean_icer: number;
  ci_icer_lower: number;
  ci_icer_upper: number;
  prob_cost_effective: Record<string, number>;
  ceac: Array<{ wtp: number; prob_ce: number }>;
  evpi: number;
  scatter: Array<{ delta_cost: number; delta_qaly: number }>;
}

export interface OWSASummary {
  parameter: string;
  low_value: number;
  high_value: number;
  icer_low: number;
  icer_high: number;
  impact: number;
}

export interface CEModelResult {
  base_case: {
    icer: number;
    delta_cost: number;
    delta_qaly: number;
    incremental_lys: number;
    total_cost_intervention: number;
    total_cost_comparator: number;
    total_qaly_intervention: number;
    total_qaly_comparator: number;
  };
  psa?: PSASummary;
  owsa?: OWSASummary[];
  wtp_analysis: {
    nhs: WTPAssessment;
    us_payer: WTPAssessment;
    societal: WTPAssessment;
  };
  model_metadata: {
    model_type: string;
    states: string[];
    cycles: number;
    cycle_length: string;
    discount_rate_costs: number;
    discount_rate_outcomes: number;
    time_horizon_years: number;
  };
  audit: AuditRecord;
}

export interface DossierSection {
  name: string;
  content: string;
  status: "complete" | "partial" | "missing";
}

export interface DossierResult {
  sections: DossierSection[];
  gaps: string[];
}

export interface IProvider {
  searchLiterature(params: LiteratureSearchParams): Promise<ToolResult>;
  buildCEModel(params: CEModelParams): Promise<ToolResult>;
  prepDossier(params: DossierParams): Promise<ToolResult>;
}
