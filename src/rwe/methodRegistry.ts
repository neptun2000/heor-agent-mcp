/**
 * RWE-methodology knowledge base — the method × attribute matrix used to
 * pick an appropriate real-world-evidence study design.
 *
 * Columns (Source / Methodology / Inclusion Criteria / Results Validity /
 * Decision Support / Common Use) reproduce a standard RWE method-comparison
 * framework. The selector layer (decisionTree.ts) ranks these profiles
 * against a user's objective, data availability, decision context, and
 * required rigour.
 *
 * This is a reference table, not a normative ranking — every method has a
 * legitimate use; "results_validity" reflects the typical internal validity
 * of the design for causal/effectiveness questions, not its worth.
 */
import type { RweMethod, RweMethodProfile } from "./types.js";

export const RWE_METHODS: Record<RweMethod, RweMethodProfile> = {
  retrospective_database_analysis: {
    method: "retrospective_database_analysis",
    label: "Retrospective Database Analysis",
    source: "Electronic health records, claims databases",
    methodology: "Analysing historical data from records",
    inclusion_criteria: "Inclusion based on available data",
    results_validity: "high",
    results_validity_note:
      "High, based on real patient data — but vulnerable to confounding by indication and unmeasured confounders; pre-specify the analysis and consider population adjustment.",
    decision_support: "Provides real-world insights for payer decisions",
    common_use: "Assessing treatment effectiveness, safety, and cost-effectiveness",
    objectives: [
      "treatment_effectiveness",
      "safety_surveillance",
      "cost_effectiveness",
      "treatment_patterns",
      "disease_epidemiology",
    ],
    requires_any_data: ["claims_database", "ehr"],
    fits_contexts: ["hta_payer", "regulatory", "internal_strategy"],
    pairs_with_tools: [
      "evidence.population_adjusted",
      "pv.signal_workflow",
      "models.cost_effectiveness",
      "data.claims_query",
    ],
  },
  survey: {
    method: "survey",
    label: "Survey",
    source: "Patient/HCP responses, questionnaires",
    methodology: "Questionnaires or interviews with respondents",
    inclusion_criteria: "Inclusion based on survey participation",
    results_validity: "moderate",
    results_validity_note:
      "Moderate — depends on survey design and response rate; subject to response and selection bias. Report the response rate and validate the instrument.",
    decision_support: "Provides subjective perspectives",
    common_use: "Understanding preferences, adherence, and quality of life",
    objectives: ["patient_preferences", "adherence", "patient_experience"],
    requires_any_data: ["patient_survey_access", "hcp_survey_access"],
    fits_contexts: ["internal_strategy", "clinical_guideline", "hta_payer"],
    pairs_with_tools: ["hta.utility", "evidence.unmet_need"],
  },
  literature_review: {
    method: "literature_review",
    label: "Literature Review",
    source: "Published research articles, systematic reviews",
    methodology: "Synthesising existing studies",
    inclusion_criteria: "Inclusion based on study relevance",
    results_validity: "high",
    results_validity_note:
      "High if a well-conducted systematic review (PRISMA + risk-of-bias assessment); narrative reviews carry selection bias.",
    decision_support: "Provides evidence from published studies",
    common_use: "Informing clinical guidelines, identifying research gaps",
    objectives: [
      "evidence_synthesis",
      "treatment_effectiveness",
      "safety_surveillance",
      "cost_effectiveness",
      "disease_epidemiology",
    ],
    requires_any_data: ["published_literature"],
    fits_contexts: [
      "hta_payer",
      "regulatory",
      "clinical_guideline",
      "internal_strategy",
    ],
    pairs_with_tools: [
      "literature.search",
      "literature.screen",
      "literature.living_review",
      "evidence.risk_of_bias",
    ],
  },
  chart_review: {
    method: "chart_review",
    label: "Chart Review",
    source: "Patient medical records",
    methodology: "Examining patient charts for treatment details",
    inclusion_criteria: "Inclusion based on available records",
    results_validity: "moderate",
    results_validity_note:
      "Moderate (depends on data accuracy and abstraction quality); use a structured abstraction form and dual review to limit error.",
    decision_support: "Provides detailed patient-level data",
    common_use: "Investigating treatment patterns, outcomes, and safety",
    objectives: [
      "treatment_patterns",
      "safety_surveillance",
      "treatment_effectiveness",
    ],
    requires_any_data: ["patient_charts"],
    fits_contexts: ["internal_strategy", "clinical_guideline", "regulatory"],
    pairs_with_tools: ["pv.signal_workflow", "pv.classify"],
  },
  social_media_listening: {
    method: "social_media_listening",
    label: "Social Media Listening",
    source: "Social media platforms (e.g. Twitter/X, Facebook), online discussions",
    methodology: "Analysing social media posts and conversations",
    inclusion_criteria:
      "Inclusion based on relevant content — defined keywords/topics, data relevance",
    results_validity: "low",
    results_validity_note:
      "Low (subject to selection bias, non-representative populations, and data-quality issues); hypothesis-generating only.",
    decision_support: "Provides real-time patient insights",
    common_use: "Monitoring patient experiences, adverse events, and sentiment",
    objectives: [
      "patient_experience",
      "adherence",
      "safety_surveillance",
      "patient_preferences",
    ],
    requires_any_data: ["social_media"],
    fits_contexts: ["exploratory", "internal_strategy"],
    pairs_with_tools: ["evidence.unmet_need"],
  },
};

export function profileFor(method: RweMethod): RweMethodProfile {
  return RWE_METHODS[method];
}

export const ALL_RWE_METHODS = Object.keys(RWE_METHODS) as RweMethod[];
