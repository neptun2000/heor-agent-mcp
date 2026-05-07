/**
 * GVD evidence pack builder.
 * Produces the `gvd_evidence_pack` pipe interface that downstream
 * country-specific hta_dossier calls can consume to pre-fill sections.
 *
 * Schema version "1.0" — bump only on breaking changes.
 */
import type { GvdSectionParams } from "./gvdSections.js";
import type { MarketPathways } from "./gvdMarketBranches.js";

export interface GvdEvidencePack {
  schema_version: "1.0";
  drug: string;
  indication: string;
  clinical_evidence_summary: string;
  comparative_effectiveness_summary: string;
  economic_summary: {
    icer_per_qaly: number;
    currency: string;
    perspective: string;
    bim_year_1_net: number;
    bim_year_3_net: number;
  };
  unmet_need_summary?: string;
  market_pathways: {
    us: string;
    uk: string;
    eu5: string;
    jp: string;
  };
  references: Array<{ id: string; citation: string; url?: string }>;
}

/**
 * Build a GvdEvidencePack from GVD section params and pre-computed market pathways.
 * Fields default gracefully when input data is sparse.
 */
export function buildGvdEvidencePack(
  params: GvdSectionParams,
  marketPathways: MarketPathways,
): GvdEvidencePack {
  return {
    schema_version: "1.0",
    drug: params.drug,
    indication: params.indication,
    clinical_evidence_summary: buildClinicalEvidenceSummary(params),
    comparative_effectiveness_summary: buildComparativeEffectivenessSummary(params),
    economic_summary: buildEconomicSummary(params),
    unmet_need_summary: params.unmet_need_summary,
    market_pathways: {
      us: marketPathways.us,
      uk: marketPathways.uk,
      eu5: marketPathways.eu5,
      jp: marketPathways.jp,
    },
    references: [],
  };
}

// ─── Private builders ─────────────────────────────────────────────────────────

function buildClinicalEvidenceSummary(params: GvdSectionParams): string {
  if (!params.evidence_summary) {
    return `Clinical evidence for ${params.drug} in ${params.indication} — populate via literature.search + screen_abstracts + risk_of_bias pipeline.`;
  }

  if (typeof params.evidence_summary === "string") {
    return params.evidence_summary.trim() ||
      `Clinical evidence for ${params.drug} in ${params.indication} — empty string provided.`;
  }

  if (Array.isArray(params.evidence_summary) && params.evidence_summary.length > 0) {
    const titles = params.evidence_summary
      .slice(0, 5)
      .map((r) => `${r.title} (${r.source}, ${r.date})`)
      .join("; ");
    const more =
      params.evidence_summary.length > 5
        ? ` [+${params.evidence_summary.length - 5} additional studies]`
        : "";
    return `Key studies: ${titles}${more}.`;
  }

  return `Clinical evidence for ${params.drug} in ${params.indication} — no evidence provided.`;
}

function buildComparativeEffectivenessSummary(params: GvdSectionParams): string {
  const socRef =
    params.comparators && params.comparators.length > 0
      ? params.comparators.join(", ")
      : "standard of care";
  return `Comparative effectiveness of ${params.drug} vs ${socRef} — populate via evidence_indirect (Bucher/NMA) or population_adjusted_comparison (MAIC/STC) tool outputs.`;
}

function buildEconomicSummary(params: GvdSectionParams): GvdEvidencePack["economic_summary"] {
  if (params.economic_icer != null) {
    return {
      icer_per_qaly: params.economic_icer,
      currency: params.economic_currency ?? "USD",
      perspective: "health system",
      bim_year_1_net: 0, // year-1 BIM not separately provided; use economic_bim_year3 as year-3
      bim_year_3_net: params.economic_bim_year3 ?? 0,
    };
  }

  return {
    icer_per_qaly: 0,
    currency: "USD",
    perspective: "health system",
    bim_year_1_net: 0,
    bim_year_3_net: 0,
  };
}
