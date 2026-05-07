/**
 * GVD per-section prose generators.
 * Each section produces substantive content from available params,
 * returning status: "complete" | "partial" | "missing" and a gap warning
 * when input data is insufficient.
 *
 * Design principles:
 * - Best-effort content + gaps[] (confirmed pattern, design log #22 Q8).
 * - No duplication of GRADE/RoB logic — Section 6 references generateGradeTable().
 * - Section 11 delegates to gvdMarketBranches.ts.
 */
import type { LiteratureResult } from "../../providers/types.js";
import { generateMarketPathways } from "./gvdMarketBranches.js";

export interface GvdSectionParams {
  drug: string;
  indication: string;
  evidence_summary?: string | LiteratureResult[];
  rob_results?: unknown;
  unmet_need_summary?: string;
  economic_icer?: number;
  economic_currency?: string;
  economic_bim_year3?: number;
  comparators?: string[];
  product_description?: string;
  safety_ae_table?: string;
  implementation_notes?: string;
}

export interface GvdSectionResult {
  content: string;
  status: "complete" | "partial" | "missing";
}

/**
 * Route a GVD section name to its prose generator.
 * Returns best-effort content + status for gap analysis.
 */
export function generateGvdSection(
  sectionName: string,
  params: GvdSectionParams,
): GvdSectionResult {
  switch (sectionName) {
    case "Executive Summary":
      return generateExecutiveSummary(params);
    case "Disease Background and Epidemiology":
      return generateDiseaseBackground(params);
    case "Current Standard of Care":
      return generateStandardOfCare(params);
    case "Unmet Need":
      return generateUnmetNeed(params);
    case "Product Description and Mechanism of Action":
      return generateProductDescription(params);
    case "Clinical Evidence":
      return generateClinicalEvidence(params);
    case "Comparative Effectiveness":
      return generateComparativeEffectiveness(params);
    case "Safety Profile":
      return generateSafetyProfile(params);
    case "Health Economic Summary":
      return generateHealthEconomicSummary(params);
    case "Patient Reported Outcomes and Quality of Life":
      return generatePatientReportedOutcomes(params);
    case "Policy Environment and Market Access Landscape":
      return generatePolicyEnvironment(params);
    case "Implementation Considerations":
      return generateImplementationConsiderations(params);
    case "Evidence Gaps and Ongoing Studies":
      return generateEvidenceGaps(params);
    default:
      return {
        content: `⚠️ ${sectionName} — unrecognized GVD section name.`,
        status: "missing",
      };
  }
}

// ─── Section generators ───────────────────────────────────────────────────────

function generateExecutiveSummary(params: GvdSectionParams): GvdSectionResult {
  const { drug, indication } = params;
  const economicLine =
    params.economic_icer != null
      ? `The deterministic ICER is ${params.economic_currency ?? "USD"} ${params.economic_icer}/QALY.`
      : "Economic model results are pending — see Section 9.";

  const socLine =
    params.comparators && params.comparators.length > 0
      ? `Current standard of care includes ${params.comparators.join(", ")}.`
      : "Standard of care characterization is pending — see Section 3.";

  const content = [
    `This Global Value Dossier (GVD) summarises the clinical, economic, and humanistic evidence for **${drug}** in **${indication}** across key international markets. It is intended to inform country-level HTA submissions and payer negotiations globally, following ISPOR Good Practices for GVD development (2017, updated 2022).`,
    "",
    `**Key points:**`,
    `- Indication: ${indication}`,
    `- ${socLine}`,
    `- ${economicLine}`,
    `- Market access landscape is summarised across US, UK, EU5, and Japan in Section 11.`,
    `- Evidence gaps and ongoing studies are listed in Section 13.`,
  ].join("\n");

  return { content, status: "complete" };
}

function generateDiseaseBackground(
  params: GvdSectionParams,
): GvdSectionResult {
  const { indication } = params;
  const evidenceBlock = formatEvidenceSummary(params.evidence_summary);

  const content = [
    `**${indication}** affects millions of patients globally, representing a significant public health burden in terms of morbidity, mortality, and healthcare resource utilization. Evidence on disease incidence, prevalence, progression, and long-term outcomes is summarised below.`,
    "",
    evidenceBlock
      ? `Relevant published evidence:\n${evidenceBlock}`
      : `⚠️ Pipe \`literature.search\` epidemiology results here to populate disease burden statistics, incidence/prevalence data, and natural history.`,
  ].join("\n");

  return {
    content,
    status: evidenceBlock ? "partial" : "partial",
  };
}

function generateStandardOfCare(params: GvdSectionParams): GvdSectionResult {
  const { drug, indication } = params;

  if (params.comparators && params.comparators.length > 0) {
    const content = [
      `Standard of care for **${indication}** includes: **${params.comparators.join(", ")}**. These agents are used as first- or second-line therapies depending on regional clinical guidelines and payer formulary requirements.`,
      "",
      `Limitations of current therapy include efficacy ceiling in refractory populations, tolerability burden (leading to treatment discontinuation), and residual disease burden in treated populations. ${drug} is proposed as a differentiated option addressing these limitations.`,
    ].join("\n");
    return { content, status: "complete" };
  }

  return {
    content: `⚠️ Standard of care not provided. Supply current comparators via the \`comparators\` parameter (list of current SoC agents) or pipe \`jca_pico_scope\` country comparator universes here.`,
    status: "missing",
  };
}

function generateUnmetNeed(params: GvdSectionParams): GvdSectionResult {
  if (params.unmet_need_summary) {
    const content = [
      params.unmet_need_summary,
      "",
      `See \`evidence.unmet_need\` report for full 4-dimension analysis (burden of illness, treatment landscape gaps, patient-reported impact, economic burden).`,
    ].join("\n");
    return { content, status: "complete" };
  }

  return {
    content: `⚠️ Unmet need assessment not provided. Run the \`evidence.unmet_need\` tool (design log #23) and pipe \`unmet_need_summary\` here via the \`hta_dossier unmet_need_summary\` parameter. The 4-dimension framework covers: (1) burden of illness, (2) treatment landscape limitations, (3) patient-reported unmet need, (4) economic/caregiver burden.`,
    status: "missing",
  };
}

function generateProductDescription(
  params: GvdSectionParams,
): GvdSectionResult {
  if (params.product_description) {
    return { content: params.product_description, status: "complete" };
  }

  return {
    content: `⚠️ Product description not provided. Include: INN (International Nonproprietary Name), ATC code, pharmacological class, mechanism of action, SmPC indication wording, route of administration, formulation, and recommended dosing schedule. Reference the approved label and any label revisions that affect the claim set.`,
    status: "missing",
  };
}

function generateClinicalEvidence(params: GvdSectionParams): GvdSectionResult {
  const evidenceBlock = formatEvidenceSummary(params.evidence_summary);

  if (evidenceBlock) {
    const content = [
      `Clinical evidence for **${params.drug}** in **${params.indication}**:`,
      "",
      evidenceBlock,
      "",
      `Full GRADE evidence profile follows below (auto-generated from \`risk_of_bias\` results when supplied). Direct citations should be validated via the \`validate_links\` tool before submission.`,
    ].join("\n");
    return { content, status: "complete" };
  }

  return {
    content: `⚠️ Clinical evidence not provided. Pipe \`literature.search\` → \`screen_abstracts\` → \`risk_of_bias\` results here. Include all pivotal RCTs, key observational studies, and any systematic reviews. GRADE evidence profile will be auto-generated when \`rob_results\` are supplied.`,
    status: "missing",
  };
}

function generateComparativeEffectiveness(
  params: GvdSectionParams,
): GvdSectionResult {
  const { drug } = params;
  const socRef =
    params.comparators && params.comparators.length > 0
      ? params.comparators.join(", ")
      : "standard of care";

  const content = [
    `Comparative effectiveness of **${drug}** vs ${socRef} was assessed via direct and indirect evidence.`,
    "",
    `⚠️ Pipe \`evidence_indirect\` (Bucher/NMA) and/or \`population_adjusted_comparison\` (MAIC/STC, NICE DSU TSD 18) outputs here to populate relative treatment effects with 95% CrI and heterogeneity statistics.`,
    "",
    `Where no head-to-head RCT exists, the ITC feasibility assessment (3-assumption framework per Cope 2014/TSD 18) should be documented here. Run \`itc_feasibility\` tool for the structured assessment.`,
  ].join("\n");

  return { content, status: "partial" };
}

function generateSafetyProfile(params: GvdSectionParams): GvdSectionResult {
  const { drug } = params;

  if (params.safety_ae_table) {
    return {
      content: [
        `Safety profile for **${drug}** from clinical trial and post-marketing sources:`,
        "",
        params.safety_ae_table,
      ].join("\n"),
      status: "complete",
    };
  }

  return {
    content: `Safety data for **${drug}** are summarised from clinical trial and post-marketing sources. Key adverse events (AEs), serious AEs, AEs of special interest, discontinuation rates, and any REMS/RMP obligations are detailed below.\n\n⚠️ AE frequency table not provided — populate from the Clinical Study Report (CSR) Summary of Safety. Include treatment-emergent AE (TEAE) rates by system organ class (SOC), Grade 3/4 events, and SAEs with between-arm comparison.`,
    status: "missing",
  };
}

function generateHealthEconomicSummary(
  params: GvdSectionParams,
): GvdSectionResult {
  if (params.economic_icer != null) {
    const currency = params.economic_currency ?? "USD";
    const bim =
      params.economic_bim_year3 != null
        ? `Year-3 net budget impact: ${currency} ${params.economic_bim_year3.toLocaleString()}.`
        : "Year-3 budget impact data not provided.";

    const content = [
      `**${params.drug}** is estimated to be cost-effective at **${currency} ${params.economic_icer.toLocaleString()}/QALY** (deterministic ICER).`,
      "",
      `Probabilistic sensitivity analysis (PSA) and cost-effectiveness acceptability curves (CEAC) are provided in the full economic model output (pipe \`cost_effectiveness_model\` results here). ${bim}`,
      "",
      `The model follows a health system perspective with lifetime horizon. QALY estimates use EQ-5D utility values. Full model documentation follows ISPOR-SMDM Modeling Good Research Practices (2012).`,
    ].join("\n");
    return { content, status: "complete" };
  }

  return {
    content: `⚠️ Economic model results not provided. Pipe \`models.cost_effectiveness\` (ICER, CEAC, PSA scatter) and \`models.budget_impact\` (year-by-year net cost) outputs here. Include: deterministic ICER, probabilistic mean ICER with 95% CI, WTP threshold comparison, EVPI, and budget impact over 3–5 years.`,
    status: "missing",
  };
}

function generatePatientReportedOutcomes(
  params: GvdSectionParams,
): GvdSectionResult {
  const { indication } = params;

  const content = [
    `**${indication}** is associated with substantial patient-reported burden across physical, emotional, and social functioning domains. Health-related quality of life (HRQoL) data using EQ-5D and disease-specific instruments are summarised below.`,
    "",
    `⚠️ Pipe \`utility_value_set\` (EQ-5D 3L/5L value sets) and PRO study results here. Document the instruments used, baseline utility scores, utility changes at key time points, and the mapping algorithm if EQ-5D was not directly collected in the pivotal trial.`,
  ].join("\n");

  return { content, status: "partial" };
}

function generatePolicyEnvironment(
  params: GvdSectionParams,
): GvdSectionResult {
  const { drug, indication } = params;
  const pathways = generateMarketPathways(drug, indication);

  const content = [
    pathways.us,
    "",
    pathways.uk,
    "",
    pathways.eu5,
    "",
    pathways.jp,
  ].join("\n");

  return { content, status: "complete" };
}

function generateImplementationConsiderations(
  params: GvdSectionParams,
): GvdSectionResult {
  if (params.implementation_notes) {
    return { content: params.implementation_notes, status: "complete" };
  }

  return {
    content: `⚠️ Implementation considerations not provided. Address the following for a complete GVD section: (1) distribution channel and supply chain requirements; (2) cold-chain or special handling requirements; (3) patient support programme (PSP) design; (4) HCP training and prescriber certification requirements; (5) REMS (US) or RMP (EU/UK) obligations; (6) launch sequencing across markets and rationale; (7) managed access programme (MAP) for pre-approval access where applicable.`,
    status: "missing",
  };
}

function generateEvidenceGaps(params: GvdSectionParams): GvdSectionResult {
  const gaps: string[] = [];

  if (!params.evidence_summary) {
    gaps.push("Clinical evidence from pivotal trials (Section 6)");
  }
  if (!params.comparators || params.comparators.length === 0) {
    gaps.push("Standard of care comparator landscape (Section 3)");
  }
  if (!params.unmet_need_summary) {
    gaps.push("Structured unmet need assessment (Section 4)");
  }
  if (params.economic_icer == null) {
    gaps.push("Cost-effectiveness model results (Section 9)");
  }
  if (!params.product_description) {
    gaps.push("Product description and mechanism of action (Section 5)");
  }
  if (!params.safety_ae_table) {
    gaps.push("Adverse event frequency table (Section 8)");
  }
  if (!params.implementation_notes) {
    gaps.push("Implementation considerations (Section 12)");
  }

  const gapsList =
    gaps.length > 0
      ? gaps.map((g) => `- ⚠️ ${g}`).join("\n")
      : "- No critical gaps identified from available input data.";

  const content = [
    `The following evidence gaps have been identified based on currently available input data:`,
    "",
    gapsList,
    "",
    `Ongoing studies that may address these gaps: ⚠️ Provide ClinicalTrials.gov identifiers and expected readout dates for relevant active or planned studies (Phase 3, RWE registries, PRO substudies, long-term follow-up studies).`,
  ].join("\n");

  return {
    content,
    status: gaps.length > 0 ? "partial" : "complete",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatEvidenceSummary(
  evidenceSummary?: string | LiteratureResult[],
): string | null {
  if (!evidenceSummary) return null;

  if (typeof evidenceSummary === "string") {
    return evidenceSummary.trim() || null;
  }

  if (Array.isArray(evidenceSummary) && evidenceSummary.length > 0) {
    return evidenceSummary
      .map((r) => `- ${r.title} (${r.source}, ${r.date})`)
      .join("\n");
  }

  return null;
}
