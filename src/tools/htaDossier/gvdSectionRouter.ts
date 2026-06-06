/**
 * GVD Section Router — main entry point for hta_dossier({hta_body:"gvd"}).
 * Thin orchestrator: maps DossierParams → GvdSectionParams,
 * dispatches to per-section generators, collects gaps, and builds the evidence pack.
 *
 * Keep this file as orchestration-only; all prose generation lives in gvdSections.ts.
 */
import type { DossierParams } from "../../providers/types.js";
import { generateGvdSection, type GvdSectionParams } from "./gvdSections.js";
import { generateMarketPathways } from "./gvdMarketBranches.js";
import {
  buildGvdEvidencePack,
  type GvdEvidencePack,
} from "./gvdEvidencePack.js";
import { extractEconomicSummary } from "./economicSummary.js";

const GVD_SECTIONS = [
  "Executive Summary",
  "Disease Background and Epidemiology",
  "Current Standard of Care",
  "Unmet Need",
  "Product Description and Mechanism of Action",
  "Clinical Evidence",
  "Comparative Effectiveness",
  "Safety Profile",
  "Health Economic Summary",
  "Patient Reported Outcomes and Quality of Life",
  "Policy Environment and Market Access Landscape",
  "Implementation Considerations",
  "Evidence Gaps and Ongoing Studies",
] as const;

export interface GvdRouterResult {
  lines: string[];
  gaps: string[];
  gvd_evidence_pack: GvdEvidencePack;
}

/**
 * Route GVD section generation.
 * Called from htaDossierPrep.ts when hta_body === "gvd".
 */
export function routeGvdSections(params: DossierParams): GvdRouterResult {
  const gvdParams = mapDossierToGvdParams(params);
  const marketPathways = generateMarketPathways(
    gvdParams.drug,
    gvdParams.indication,
  );

  const lines: string[] = [];
  const gaps: string[] = [];

  for (const sectionName of GVD_SECTIONS) {
    const { content, status } = generateGvdSection(sectionName, gvdParams);
    lines.push(`### ${sectionName}`);
    lines.push(content);
    lines.push("");

    if (status === "missing") {
      gaps.push(sectionName);
    }
  }

  const gvd_evidence_pack = buildGvdEvidencePack(gvdParams, marketPathways);

  return { lines, gaps, gvd_evidence_pack };
}

// ─── Param mapping ────────────────────────────────────────────────────────────

function mapDossierToGvdParams(params: DossierParams): GvdSectionParams {
  // Extract ICER, currency, and placeholder flags from model_results when
  // provided. Design log #37: the _placeholder / _defaulted_inputs guard set
  // by hta_workflow (design log #35) must survive into the GVD prose.
  const econ = extractEconomicSummary(params.model_results);

  return {
    drug: params.drug_name,
    indication: params.indication,
    evidence_summary: params.evidence_summary,
    rob_results: params.rob_results,
    unmet_need_summary: params.unmet_need_summary,
    economic_icer: econ.icer,
    economic_currency: econ.currency,
    economic_bim_year3: undefined,
    economic_placeholder: econ.placeholder,
    economic_defaulted_inputs: econ.defaultedInputs,
    // comparators come from picos if provided
    comparators: extractComparators(params),
    product_description: undefined,
    safety_ae_table: undefined,
    implementation_notes: undefined,
  };
}

function extractComparators(params: DossierParams): string[] | undefined {
  if (!params.picos || params.picos.length === 0) return undefined;
  const comparators = params.picos
    .map((p) => p.comparator)
    .filter((c): c is string => Boolean(c));
  return comparators.length > 0 ? comparators : undefined;
}
