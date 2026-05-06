/**
 * Type definitions for irb_review (design log #21).
 *
 * Structures the output of the IRB / Ethics Committee submission classifier
 * tool. Pure types — no runtime logic.
 *
 * irb_ruleset versioning: bump when the underlying regulatory framework
 * changes (e.g., a Common Rule revision, a new EU CTR amendment, an HIPAA
 * de-identification update). Current value reflects the v1 cut.
 */

export type StudyDesign =
  | "interventional"
  | "non_interventional_prospective"
  | "retrospective_chart_review"
  | "registry"
  | "secondary_data_analysis"
  | "specimen_repository"
  | "questionnaire_only";

export type DataHandling =
  | "fully_identifiable"
  | "pseudonymized"
  | "anonymized_safe_harbor"
  | "anonymized_expert_determination"
  | "aggregate_only";

export type RiskLevel = "minimal" | "greater_than_minimal" | "unknown";

export type FundingSource =
  | "industry"
  | "nih"
  | "other_government"
  | "foundation"
  | "academic"
  | "none";

export type IrbJurisdiction = "us_irb" | "eu_cec" | "uk_hra_rec" | "other";

export type ReviewTierUs =
  | "exempt"
  | "expedited"
  | "full_board"
  | "not_applicable";

export type ReviewTierEu =
  | "national_only"
  | "ctr_multi_state"
  | "non_interventional_only";

export type VulnerableGroup =
  | "pediatric"
  | "pregnant"
  | "prisoners"
  | "decisionally_impaired";

export interface VulnerablePopulationObligation {
  group: VulnerableGroup;
  regulatory_basis: string;
  obligations: string[];
  v2_age_tier_table_pending: boolean;
}

export type DeIdMethod =
  | "safe_harbor"
  | "expert_determination"
  | "pseudonymization"
  | "not_required"
  | "must_implement";

export interface DataManagementPlan {
  gdpr_special_category: boolean;
  hipaa_phi: boolean;
  de_identification_method: DeIdMethod;
  cross_border_transfer_obligations: string[];
}

export type SaeFramework =
  | "ctr_536_2014"
  | "fda_ind_safety"
  | "post_marketing_psur"
  | "none";

export interface SaeReportingObligations {
  framework: SaeFramework;
  timelines: Array<{
    event_type: string;
    reporting_window: string;
  }>;
}

export type IcfTier = "basic" | "standard" | "complex";

export type CoiFramework =
  | "phs_42_cfr_50"
  | "eu_ctr_annex_i_point_66"
  | "both"
  | "none";

export interface IrbAssessment {
  review_tier_us: ReviewTierUs | null;
  exempt_category_us: number | null;
  expedited_categories_us: number[];
  review_tier_eu: ReviewTierEu | null;
  eu_cec_timeline_days: number | null;
  vulnerable_population_obligations: VulnerablePopulationObligation[];
  data_management_plan: DataManagementPlan;
  sae_reporting_obligations: SaeReportingObligations;
  icf_complexity_tier: IcfTier;
  coi_disclosure_required: boolean;
  coi_framework: CoiFramework;
  cover_letter_template: string;
  rationale: string;
  advisory_warnings: string[];
  irb_ruleset: "2026-05";
}

export interface IrbReviewInput {
  study_design: StudyDesign;
  intervention: string;
  indication: string;
  population_includes_pediatric: boolean;
  population_includes_pregnant: boolean;
  population_includes_prisoners: boolean;
  population_includes_decisionally_impaired: boolean;
  jurisdictions: IrbJurisdiction[];
  data_handling: DataHandling;
  risk_level: RiskLevel;
  funding_source: FundingSource;
  multi_site: boolean;
  expedited_category_claim?: number[];
  /** Optional structured pv_classify output. Only `primary_category` is read. */
  pv_classification?: { primary_category?: string } | undefined;
  /**
   * Hint flags that disambiguate exempt/expedited categories for inputs
   * whose study_design alone is ambiguous. Each maps to a specific Common
   * Rule §46.104 / §46.110 leaf:
   *   - `exempt_category_hint: "educational"` → §46.104 cat 1
   *   - `benign_behavioural: true`            → §46.104 cat 3
   *   - `federal_demonstration: true`         → §46.104 cat 5
   *   - `taste_test: true`                    → §46.104 cat 6
   *   - `broad_consent_obtained: true` + spec → §46.104 cat 7 / 8
   *   - `marketed_drug: true`                 → §46.110 cat 1
   *   - `blood_draw_within_limits: true`      → §46.110 cat 2
   *   - `noninvasive_collection: true`        → §46.110 cat 3
   *   - `noninvasive_procedure: true`         → §46.110 cat 4
   *   - `recording_collection: true`          → §46.110 cat 6
   * Without the hint, the tree falls back to category 4 / 5 / 7 by
   * study_design + data_handling.
   */
  exempt_category_hint?: "educational";
  benign_behavioural?: boolean;
  federal_demonstration?: boolean;
  taste_test?: boolean;
  broad_consent_obtained?: boolean;
  marketed_drug?: boolean;
  blood_draw_within_limits?: boolean;
  noninvasive_collection?: boolean;
  noninvasive_procedure?: boolean;
  recording_collection?: boolean;
}

export const IRB_RULESET = "2026-05" as const;
