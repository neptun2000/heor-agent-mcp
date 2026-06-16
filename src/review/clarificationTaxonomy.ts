// heor-agent-mcp/src/review/clarificationTaxonomy.ts
/**
 * Clarification-question taxonomy for hta.review_simulation (design log #38).
 *
 * Deterministic per-(category × body) question templates. The dossier scan
 * (dossierScan.ts) decides which categories fire and at what severity; this
 * table supplies the body-appropriate phrasing. Templates may contain
 * {comparator}, {drug}, {indication}, {term} placeholders filled by `fill`.
 *
 * Grows by category as detectors are added (TDD). The union `CategoryKey`
 * lists only implemented categories so the table stays exhaustive + type-safe.
 */
export type Severity = "critical" | "standard" | "minor";
export type ReviewBody = "nice" | "gba_iqwig";

export type CategoryKey =
  | "comparator"
  | "indirect_comparison"
  | "survival_extrapolation"
  | "clinical_rob"
  | "economic_model"
  | "utilities"
  | "uncertainty"
  | "subgroups"
  | "rwe"
  | "innovation";

export const CATEGORY_ORDER: CategoryKey[] = [
  "comparator",
  "indirect_comparison",
  "survival_extrapolation",
  "clinical_rob",
  "economic_model",
  "utilities",
  "uncertainty",
  "subgroups",
  "rwe",
  "innovation",
];

export const TAXONOMY_REVISION = "2026-06-16";

export interface BodyText {
  question: string;
  rationale: string;
  what_they_look_for: string;
  suggested_response: string;
}

export interface TaxonomyEntry {
  key: CategoryKey;
  label: string;
  bodies: Record<ReviewBody, BodyText>;
}

export const BODY_LABEL: Record<ReviewBody, string> = {
  nice: "NICE EAG",
  gba_iqwig: "G-BA / IQWiG",
};

export const TAXONOMY: Record<CategoryKey, TaxonomyEntry> = {
  comparator: {
    key: "comparator",
    label: "Comparator choice / SoC relevance",
    bodies: {
      nice: {
        question:
          "Please justify the choice of {comparator} as the relevant comparator versus the standard of care used in NHS practice for {indication}, and the exclusion of any other relevant options.",
        rationale:
          "The EAG checks that the comparator reflects the relevant NHS standard of care; an inappropriate comparator undermines the entire comparison.",
        what_they_look_for:
          "Marketing status and positioning rationale for each comparator, and why omitted options are not relevant.",
        suggested_response:
          "Cite the current NHS treatment pathway and guideline positioning; where a relevant comparator lacks head-to-head data, add an indirect comparison.",
      },
      gba_iqwig: {
        question:
          "Please justify {comparator} as the appropriate comparator therapy (zweckmäßige Vergleichstherapie / zVT) for {indication}, consistent with the G-BA determination.",
        rationale:
          "G-BA assesses added benefit only against the appropriate comparator therapy (zVT); a mismatch with the zVT can invalidate the dossier.",
        what_they_look_for:
          "Alignment with the G-BA-determined zVT and a justification wherever the chosen comparator deviates from it.",
        suggested_response:
          "Map the chosen comparator to the G-BA zVT determination; justify any deviation with clinical-practice evidence.",
      },
    },
  },
  indirect_comparison: {
    key: "indirect_comparison",
    label: "Indirect comparison validity",
    bodies: {
      nice: {
        question:
          "Please justify the indirect comparison versus {comparator}: the choice of method (Bucher / NMA / MAIC), whether the exchangeability, homogeneity and consistency assumptions hold, and the resulting uncertainty. Where head-to-head data are absent and no indirect comparison was presented, one is required.",
        rationale:
          "Without head-to-head data the comparison versus {comparator} rests entirely on an indirect comparison, whose validity the EAG scrutinises closely.",
        what_they_look_for:
          "A named ITC method, an explicit assessment of the three ITC assumptions, and sensitivity to them.",
        suggested_response:
          "Report the ITC method and feasibility assessment (NICE DSU TSD 18), the assumption checks, and scenario analyses.",
      },
      gba_iqwig: {
        question:
          "Please justify the indirect comparison versus the appropriate comparator therapy ({comparator}): the method, the similarity and consistency of the included studies, and the certainty of results.",
        rationale:
          "IQWiG applies strict criteria to indirect comparisons; an unadjusted or assumption-violating ITC is typically downgraded or rejected.",
        what_they_look_for:
          "An adjusted indirect comparison with a common comparator, a similarity assessment, and a certainty-of-results grade.",
        suggested_response:
          "Provide the adjusted ITC, the cross-study similarity assessment, and the certainty-of-results rating.",
      },
    },
  },
  survival_extrapolation: {
    key: "survival_extrapolation",
    label: "Survival extrapolation",
    bodies: {
      nice: {
        question:
          "Please justify the parametric survival model(s) used to extrapolate {indication} outcomes beyond trial follow-up, including the choice among candidate distributions and the clinical plausibility of the long-term hazard.",
        rationale:
          "Extrapolated survival drives the QALY gain; the EAG checks distribution selection, fit and clinical plausibility (NICE DSU TSD 14).",
        what_they_look_for:
          "Candidate distributions compared (AIC/BIC + visual fit), external/clinical validity of the long-term tail, and extrapolation scenarios.",
        suggested_response:
          "Present all candidate parametric fits with AIC/BIC and visual diagnostics; justify the base case on clinical plausibility per TSD 14; include extrapolation scenarios.",
      },
      gba_iqwig: {
        question:
          "Please justify the survival extrapolation approach for {indication}, including parametric model selection and the handling of immature data.",
        rationale:
          "Where time-to-event data are immature, IQWiG scrutinises extrapolation assumptions and may restrict conclusions to the observed period.",
        what_they_look_for:
          "A model-selection rationale, the maturity of the data, and sensitivity to alternative extrapolations.",
        suggested_response:
          "Document model selection and data maturity; present alternative-extrapolation sensitivity analyses.",
      },
    },
  },
  clinical_rob: {
    key: "clinical_rob",
    label: "Clinical effectiveness / risk of bias",
    bodies: {
      nice: {
        question:
          "The evidence base relies on {term} data. Please address the resulting risk of bias and how it affects the certainty of the effect estimates.",
        rationale:
          "{term} evidence raises the risk of bias and weakens causal inference; the EAG will downgrade certainty accordingly.",
        what_they_look_for:
          "A formal risk-of-bias / GRADE assessment and any adjustment or sensitivity analysis addressing the limitation.",
        suggested_response:
          "Provide a RoB 2 / ROBINS-I assessment and a GRADE certainty rating; where feasible add an external-control or sensitivity analysis.",
      },
      gba_iqwig: {
        question:
          "The evidence base relies on {term} data. Please address the certainty-of-results implications under IQWiG criteria.",
        rationale:
          "IQWiG generally regards {term} evidence as carrying a high risk of bias, limiting the certainty of added-benefit conclusions.",
        what_they_look_for:
          "A risk-of-bias appraisal and a justified certainty-of-results category.",
        suggested_response:
          "Provide the risk-of-bias appraisal and the resulting certainty-of-results category; justify any added-benefit claim against it.",
      },
    },
  },
  economic_model: {
    key: "economic_model",
    label: "Economic model structure",
    bodies: {
      nice: {
        question:
          "Please describe and justify the economic model structure for {indication}: model type, health states, cycle length, time horizon, discount rates, and half-cycle correction.",
        rationale:
          "The EAG must be able to reproduce and critique the cost-effectiveness estimate; undocumented structure blocks that and is a common major issue.",
        what_they_look_for:
          "A clearly specified model type and structure with a justified cycle length, time horizon, discounting, and half-cycle correction.",
        suggested_response:
          "Provide the model schematic and a structure table; justify the horizon (lifetime unless stated) and cycle length against the disease course.",
      },
      gba_iqwig: {
        question:
          "Please justify the treatment-cost and patient-number estimates (AMNOG Module 3) for {indication}, including the data sources and assumptions.",
        rationale:
          "G-BA Module 3 assesses the costs of therapy and the size of the target population; unsupported figures are challenged.",
        what_they_look_for:
          "Transparent, source-backed annual treatment costs and eligible-patient counts.",
        suggested_response:
          "Document the cost and epidemiology sources and the derivation of patient numbers.",
      },
    },
  },
  utilities: {
    key: "utilities",
    label: "Health-state utilities",
    bodies: {
      nice: {
        question:
          "Please justify the health-state utility values for {indication}: their source, the measure used (e.g. EQ-5D version and value set), and any mapping or crosswalk applied.",
        rationale:
          "Utilities drive QALYs; the EAG checks the measure, the value set (NICE reference case), and mapping validity — note the 2026 UK EQ-5D-5L value-set transition.",
        what_they_look_for:
          "Reference-case-consistent utilities, the value set used, and justification for any crosswalk between 5L and 3L.",
        suggested_response:
          "Report the utility source and instrument; state the value set; if EQ-5D-5L was used, address the NICE reference-case position and any crosswalk.",
      },
      gba_iqwig: {
        question:
          "Please describe the patient-reported outcome and quality-of-life instruments used for {indication} and their interpretation under IQWiG criteria.",
        rationale:
          "IQWiG evaluates HRQoL as a patient-relevant endpoint; instrument validity and responder definitions are scrutinised.",
        what_they_look_for:
          "Validated instruments, pre-specified responder thresholds, and complete reporting.",
        suggested_response:
          "Report the validated instrument, the pre-specified responder definition, and the completeness of the HRQoL data.",
      },
    },
  },
  uncertainty: {
    key: "uncertainty",
    label: "Decision uncertainty",
    bodies: {
      nice: {
        question:
          "Please characterise decision uncertainty for {indication}: present probabilistic sensitivity analysis (with CEAC), deterministic sensitivity analyses, and structural scenario analyses.",
        rationale:
          "The EAG relies on PSA and scenarios to judge the robustness of the ICER; their absence is routinely raised.",
        what_they_look_for:
          "A full PSA with CEAC, one-way sensitivity analyses, and scenario/structural analyses on key assumptions.",
        suggested_response:
          "Add a 1,000+ iteration PSA with CEAC, a tornado/OWSA, and scenario analyses on the most influential parameters and structural choices.",
      },
      gba_iqwig: {
        question:
          "Please characterise the uncertainty in the added-benefit and cost/population estimates for {indication}, including sensitivity analyses on key assumptions.",
        rationale:
          "IQWiG examines how sensitive the conclusions are to assumptions; unquantified uncertainty weakens the dossier.",
        what_they_look_for:
          "Sensitivity analyses on the effect estimates and on the cost/population inputs.",
        suggested_response:
          "Present sensitivity analyses on the effect estimates and on the Module 3 cost/population inputs.",
      },
    },
  },
  subgroups: {
    key: "subgroups",
    label: "Subgroups",
    bodies: {
      nice: {
        question:
          "Please clarify whether the subgroup analyses for {indication} were pre-specified, and justify any subgroup-based conclusions given the risk of false-positive findings.",
        rationale:
          "Post-hoc or unadjusted subgroup claims carry a high false-positive risk; the EAG discounts conclusions that are not pre-specified and multiplicity-controlled.",
        what_they_look_for:
          "Pre-specification, a clear hypothesis, and multiplicity control for any subgroup driving the recommendation.",
        suggested_response:
          "State which subgroups were pre-specified; report interaction tests and multiplicity adjustment; avoid decisions resting on post-hoc subgroups.",
      },
      gba_iqwig: {
        question:
          "Please justify the subgroup analyses for {indication} under IQWiG criteria, including pre-specification and effect-modifier interaction tests.",
        rationale:
          "IQWiG requires effect-modification (interaction) tests and pre-specification before accepting subgroup-specific added-benefit claims.",
        what_they_look_for:
          "Pre-specified subgroups with significant interaction tests for any differentiated added-benefit claim.",
        suggested_response:
          "Provide interaction p-values for the relevant effect modifiers (age, sex, severity) and restrict claims to pre-specified subgroups.",
      },
    },
  },
  rwe: {
    key: "rwe",
    label: "Real-world evidence",
    bodies: {
      nice: {
        question:
          "Please justify the real-world evidence used for {indication}: data provenance, representativeness of the population, and the risk of confounding and missing data.",
        rationale:
          "RWE generalisability and confounding are central EAG concerns; left unaddressed, they undermine the effect estimates.",
        what_they_look_for:
          "Data-source provenance, population representativeness, confounding adjustment, and a missing-data strategy.",
        suggested_response:
          "Document the data source and population, the confounding-adjustment method, and sensitivity analyses for unmeasured confounding.",
      },
      gba_iqwig: {
        question:
          "Please justify the real-world evidence for {indication} under IQWiG criteria, including study design, confounding control, and data quality.",
        rationale:
          "IQWiG accepts RWE only under strict design and confounding-control conditions; weaknesses lower the certainty of results.",
        what_they_look_for:
          "An appropriate design, confounding control, and documented data quality.",
        suggested_response:
          "Document the design, the confounding-control strategy, and the data-quality assessment.",
      },
    },
  },
  innovation: {
    key: "innovation",
    label: "Innovation / added benefit",
    bodies: {
      nice: {
        question:
          "Please articulate the innovation and unmet need addressed by {drug} in {indication}, including any benefits not captured in the QALY.",
        rationale:
          "NICE considers innovation and uncaptured benefits; a weak unmet-need narrative misses an opportunity, especially near the cost-effectiveness threshold.",
        what_they_look_for:
          "A clear unmet-need statement and any substantial benefits not captured in the reference-case QALY.",
        suggested_response:
          "State the unmet need and the nature of the step change; identify any uncaptured health benefits for the committee to weigh.",
      },
      gba_iqwig: {
        question:
          "Please quantify the extent of added benefit (Ausmaß des Zusatznutzens) for {drug} in {indication} versus the appropriate comparator therapy, with the supporting endpoint evidence.",
        rationale:
          "G-BA grades the magnitude of added benefit (major / considerable / minor / non-quantifiable); an unquantified claim defaults to no added benefit.",
        what_they_look_for:
          "An explicit added-benefit category supported by patient-relevant endpoints and the certainty of results.",
        suggested_response:
          "Map each patient-relevant endpoint to an added-benefit category and justify the overall magnitude rating.",
      },
    },
  },
};

/** Replace {token} placeholders with vars; unknown tokens are left intact. */
export function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}
