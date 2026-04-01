import type { AuditRecord } from "../audit/types.js";

export type OutputFormat = "text" | "json" | "docx";
export type HtaBody = "nice" | "ema" | "fda" | "iqwig" | "has";
export type SubmissionType = "sta" | "mta" | "early_access";
export type DataSource = "pubmed" | "clinicaltrials" | "biorxiv" | "chembl";
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
}

export interface DossierParams {
  hta_body: HtaBody;
  submission_type: SubmissionType;
  drug_name: string;
  indication: string;
  evidence_summary?: string | LiteratureResult[];
  model_results?: CEModelResult;
  output_format?: OutputFormat;
}

export interface ToolResult {
  content: string | object;
  audit: AuditRecord;
}

export interface CEModelResult {
  icer: number;
  currency: string;
  interpretation: string;
  sensitivity_range: { low: number; high: number };
  model_structure: string;
  disclaimer: string;
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
