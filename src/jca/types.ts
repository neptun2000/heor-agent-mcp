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

export type OutcomePriority = "OS" | "PFS" | "HRQoL" | "AE" | "remission" | "other";

export interface ComparatorEntry {
  molecule: string;
  rationale: string;
  outcome_instrument_preferences: string[];
}

export interface CountryProfile {
  jurisdiction: Jurisdiction;
  hta_body: string;
  outcome_instrument_preferences: string[];
  outcome_priority: OutcomePriority[];
  /** Pure function — given a drug-class and indication category, returns the comparator universe for this country. */
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
  | "rheumatology"
  | "neurology"
  | "rare_disease"
  | "infectious_disease"
  | "other";

export interface PicoMatrix {
  drug: string;
  indication: string;
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
