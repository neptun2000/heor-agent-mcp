export type PvCategory =
  | "PASS_imposed"
  | "PASS_voluntary"
  | "PAES"
  | "RMP_Annex_4_study"
  | "DUS"
  | "active_surveillance_registry"
  | "pregnancy_registry"
  | "spontaneous_reporting_only"
  | "ICH_E2E_pharmacovigilance_plan"
  | "not_pv_study";

export type GvpModule = "V" | "VI" | "VIII" | "VIII_Addendum_I";

export type Jurisdiction = "eu" | "us" | "uk" | "japan" | "china";

export interface PvClassification {
  primary_category: PvCategory;
  alternatives: PvCategory[];
  gvp_module: GvpModule;
  gvp_revision: "rev_4";
  /**
   * Plain-language ENCePP study category label (NOT a registered protocol
   * template ID — ENCePP does not maintain a public catalogue of reusable
   * template IDs). Examples: "PASS — post-authorisation safety study (Module VIII)".
   * Use this as a category label only; consult the ENCePP Code of Conduct
   * checklist and the EUPAS register for actual protocol templates.
   */
  encepp_study_category?: string;
  rmp_implications: string[];
  fda_analogue?: string;
  submission_obligations: string[];
  rationale: string;
}

export interface PvClassifyInput {
  drug: string;
  indication: string;
  study_design:
    | "rct"
    | "single_arm"
    | "prospective_cohort"
    | "retrospective_cohort"
    | "case_control"
    | "registry"
    | "spontaneous_reports"
    | "drug_utilization"
    | "clinical_trial_extension"
    | "real_world_evidence";
  primary_objective:
    | "safety"
    | "efficacy"
    | "effectiveness"
    | "drug_utilization"
    | "natural_history"
    | "risk_minimisation_evaluation";
  regulatory_context:
    | "pre_authorisation"
    | "post_authorisation"
    | "conditional_approval"
    | "accelerated_approval"
    | "rmp_commitment";
  imposed_by_authority: boolean;
  population_includes_pregnant: boolean;
  population_includes_paediatric: boolean;
  multi_country: boolean;
  jurisdictions: Jurisdiction[];
}
