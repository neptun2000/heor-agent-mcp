export type Jurisdiction = "de" | "fr" | "it" | "es" | "nl" | "uk" | "eu_other";

export type DrugClass =
  | "monoclonal_antibody"
  | "small_molecule"
  | "atmp_cell"
  | "atmp_gene"
  | "atmp_tissue"
  | "biosimilar"
  | "vaccine"
  | "radiopharmaceutical"
  | "other";

export type LineOfTherapy =
  | "first_line"
  | "second_line"
  | "third_line_plus"
  | "any";

export type OutcomePriority =
  | "OS"
  | "PFS"
  | "HRQoL"
  | "AE"
  | "remission"
  | "CV_death_or_HF_hospitalization" // HFrEF composite primary (DAPA-HF, EMPEROR-Reduced)
  | "CV_death"
  | "HF_hospitalization"
  | "all_cause_mortality"
  | "NYHA_progression"
  | "UMSARS_I_progression" // MSA: activities of daily living
  | "UMSARS_II_progression" // MSA: motor function
  | "UMSARS_IV_global" // MSA: global disability (1-5 scale)
  | "time_to_UMSARS_IV4" // MSA: time to wheelchair
  | "MDS_UPDRS_III_progression" // PD: motor subscale
  | "time_to_levodopa_failure" // PD: need for rescue
  | "ADAS_Cog_progression" // AD: cognitive decline
  | "MMSE_decline" // AD: cognitive screening
  | "time_to_MMSE_below24" // AD: time to clinically meaningful impairment
  | "time_to_institutionalization" // AD: long-term outcome
  | "other";

export interface ComparatorEntry {
  molecule: string;
  rationale: string;
  outcome_instrument_preferences: string[];
}

export interface CountryProfile {
  jurisdiction: Jurisdiction;
  hta_body: string;
  /** Pure function — given a drug-class and indication category, returns the comparator universe for this country.
   * Outcome instruments + priority order live on each ComparatorEntry / are derived from the indication category;
   * intentionally NOT cached on the country profile to avoid a dead-field trap. */
  comparators: (
    indication_category: IndicationCategory,
    drug_class: DrugClass,
    line: LineOfTherapy,
  ) => ComparatorEntry[];
  population_subgroups: (indication_category: IndicationCategory) => string[];
}

export type IndicationCategory =
  | "oncology_nsclc"
  | "oncology_other"
  | "ibd_uc"
  | "ibd_cd"
  | "diabetes_t2"
  | "obesity"
  | "cardiovascular"
  | "cardiovascular_hfref"
  | "rheumatology"
  | "neurology"
  | "neurology_msa" // Multiple System Atrophy (orphan, JCA Phase 2 = 2028)
  | "neurology_pd" // Parkinson's disease (non-orphan, JCA Phase 3 = 2030)
  | "neurology_ad" // Alzheimer's disease (non-orphan, JCA Phase 3 = 2030)
  | "rare_disease"
  | "infectious_disease"
  | "other";

export interface PicoMatrix {
  drug: string;
  indication: string;
  indication_category: IndicationCategory;
  jca_revision: "2026-05";
  picos: Array<{
    id: string;
    population: string;
    comparator: string;
    outcomes: string[];
  }>;
  country_specific: Array<{
    jurisdiction: Jurisdiction;
    hta_body: string;
    comparators: ComparatorEntry[];
    population_subgroups: string[];
    outcome_priorities: OutcomePriority[];
  }>;
  heterogeneity_warning: boolean;
  distinct_comparator_count: number;
  rationale: string;
}
