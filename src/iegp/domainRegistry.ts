/**
 * Per-domain metadata for the iEGP planner: the recommended evidence-
 * generation activity when a domain is a gap, the tool that operationalises
 * it, and the deliverables it unblocks. Reference table, no I/O.
 */
import type { DomainMeta, EvidenceDomain } from "./types.js";

export const DOMAIN_REGISTRY: Record<EvidenceDomain, DomainMeta> = {
  epidemiology: {
    domain: "epidemiology",
    label: "Epidemiology & natural history",
    recommended_design:
      "Retrospective database analysis or a targeted literature review of incidence/prevalence/natural history",
    tool: "rwe.method_select / literature.search",
    unblocks: ["Living GVD", "HTA submission", "JCA submission"],
  },
  disease_burden: {
    domain: "disease_burden",
    label: "Disease burden",
    recommended_design:
      "Burden-of-illness study (database or literature) covering mortality, morbidity, and resource use",
    tool: "evidence.unmet_need / literature.search",
    unblocks: ["Living GVD", "HTA unmet-need section"],
  },
  clinical_efficacy: {
    domain: "clinical_efficacy",
    label: "Clinical efficacy",
    recommended_design:
      "RCT evidence synthesis; if pivotal-trial gaps remain, scope a new trial's eligibility",
    tool: "literature.search / evidence.risk_of_bias / trial.enrollment_criteria",
    unblocks: ["HTA submission", "JCA submission"],
  },
  comparative_effectiveness: {
    domain: "comparative_effectiveness",
    label: "Comparative effectiveness vs relevant comparators",
    recommended_design:
      "Indirect treatment comparison / NMA (or MAIC/STC if populations differ); head-to-head trial if feasibility allows",
    tool: "evidence.network / evidence.indirect / workflow.maic",
    unblocks: ["HTA submission", "JCA submission", "Living GVD"],
  },
  safety: {
    domain: "safety",
    label: "Safety / real-world safety",
    recommended_design:
      "PASS or active-surveillance registry; spontaneous-report disproportionality for class context",
    tool: "pv.classify / pv.signal_workflow / pv.comparative_safety",
    unblocks: ["HTA submission", "Regulatory / RMP"],
  },
  economic_cea: {
    domain: "economic_cea",
    label: "Cost-effectiveness",
    recommended_design:
      "De novo cost-effectiveness model (Markov / partitioned survival) per the reference case",
    tool: "models.cost_effectiveness",
    unblocks: ["HTA submission", "JCA submission"],
  },
  budget_impact: {
    domain: "budget_impact",
    label: "Budget impact",
    recommended_design: "ISPOR-compliant budget impact model with epidemiology-based uptake",
    tool: "models.budget_impact",
    unblocks: ["HTA submission", "Payer / market access"],
  },
  hrqol_utilities: {
    domain: "hrqol_utilities",
    label: "HRQoL / utilities",
    recommended_design:
      "EQ-5D collection or mapping study; vignette/TTO study where direct utilities are missing",
    tool: "hta.utility",
    unblocks: ["HTA submission (QALYs)", "Living GVD"],
  },
  adherence: {
    domain: "adherence",
    label: "Treatment adherence / persistence",
    recommended_design:
      "Retrospective database analysis of persistence; patient survey for drivers/barriers",
    tool: "rwe.method_select",
    unblocks: ["Payer / market access", "Living GVD"],
  },
  unmet_need: {
    domain: "unmet_need",
    label: "Unmet need",
    recommended_design:
      "Structured unmet-need synthesis across burden, treatment landscape, QoL, and economics",
    tool: "evidence.unmet_need",
    unblocks: ["HTA submission", "Living GVD"],
  },
  patient_experience: {
    domain: "patient_experience",
    label: "Patient experience / preferences",
    recommended_design:
      "Patient survey or, for exploratory insight, a governed social-listening study",
    tool: "rwe.social_listening_protocol / rwe.method_select",
    unblocks: ["Living GVD", "Payer / market access"],
  },
};

export const ALL_DOMAINS = Object.keys(DOMAIN_REGISTRY) as EvidenceDomain[];

/** Domains that are decision-critical for a given context (gaps escalate). */
export const CRITICAL_DOMAINS: Record<string, EvidenceDomain[]> = {
  hta_payer: ["clinical_efficacy", "comparative_effectiveness", "economic_cea", "budget_impact"],
  jca: ["clinical_efficacy", "comparative_effectiveness"],
  market_access: ["comparative_effectiveness", "economic_cea", "budget_impact"],
  regulatory: ["clinical_efficacy", "safety"],
  internal: [],
};
