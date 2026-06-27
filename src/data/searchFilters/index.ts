import type { Database, FilterBlock, StrandId } from "../../search/types.js";
import { getEmbaseOverrideBlock, getEmbaseStrandOverride } from "./embaseOverrides.js";
import { getAgeLimit, type AgeLimitGroup } from "./ageLimits.js";
import { getExclusionFilter } from "./exclusions.js";
import {
  SIGN_FILTERS,
  SIGN_PAGE_URL,
  type SignDatabaseSection,
  type SignFilterId,
  type SignFilterLine,
} from "./signCatalog.js";
import { collapseSignFilterToOrLine } from "./signFilterUtils.js";

/** HEORAgent review strand → SIGN methodological filter template. */
export const STRAND_SIGN_FILTER_MAP: Record<StrandId, SignFilterId> = {
  clinical: "randomised-controlled-trials",
  economic: "economic-studies",
  hrqol: "patient-issues",
  epidemiology: "observational-studies",
};

/** Additional SIGN templates available beyond the four HEOR strands. */
export const AUXILIARY_SIGN_FILTERS: SignFilterId[] = [
  "systematic-reviews",
  "diagnostic-studies",
];

const DATABASE_SECTION_MAP: Record<Database, SignDatabaseSection> = {
  pubmed: "medline",
  embase: "embase",
};

function signProvenance(id: SignFilterId) {
  const filter = SIGN_FILTERS[id];
  return {
    source: `SIGN — ${filter.title}`,
    url: SIGN_PAGE_URL,
    templateUrl: filter.templateUrl,
    citation: `Scottish Intercollegiate Guidelines Network (SIGN). ${filter.title} search filter. ${filter.attribution}`,
  };
}

function signLinesToQueries(lines: SignFilterLine[]): string[] {
  return lines.map((line) => line.query);
}

/** SIGN Ovid Medline syntax for PubMed/MEDLINE strategies (design-log #44). */
export function getSignFilterBlock(
  signId: SignFilterId,
  database: Database = "pubmed",
): FilterBlock {
  const section = DATABASE_SECTION_MAP[database];
  const filter = SIGN_FILTERS[signId];
  const lines = filter.sections[section];
  if (!lines?.length) {
    throw new Error(
      `SIGN filter "${signId}" has no ${section} section for database "${database}"`,
    );
  }
  return {
    id: `sign-${signId}-${section}`,
    database,
    lines: signLinesToQueries(lines),
    provenance: signProvenance(signId),
  };
}

/** Methodological filter for a HEOR review strand, sourced from SIGN templates. */
export function getFilter(strand: StrandId, database: Database = "pubmed"): FilterBlock {
  const signId = STRAND_SIGN_FILTER_MAP[strand];
  const block = getSignFilterBlock(signId, database);
  return { ...block, strand };
}

/**
 * Single-line strand filter for the outer numbered-line assembler.
 * Embase: colleague fixture override when available, else collapsed SIGN Embase terms.
 * PubMed: collapsed SIGN Medline searchable terms (Ovid boolean lines excluded).
 */
export function getStrandFilterForAssembly(
  strand: StrandId,
  database: Database,
): string[] {
  if (database === "embase") {
    const override = getEmbaseStrandOverride(strand);
    if (override) return [override];
  }
  const signLines = getFilter(strand, database).lines;
  return [collapseSignFilterToOrLine(signLines)];
}

export function getSignFilterIdForStrand(strand: StrandId): SignFilterId {
  return STRAND_SIGN_FILTER_MAP[strand];
}

export { getAgeLimit, type AgeLimitGroup } from "./ageLimits.js";
export { getExclusionFilter } from "./exclusions.js";
export { getEmbaseOverrideBlock, getEmbaseStrandOverride } from "./embaseOverrides.js";
export { collapseSignFilterToOrLine, isSignBooleanLine } from "./signFilterUtils.js";

export {
  SIGN_FILTERS,
  SIGN_PAGE_URL,
  getSignFilter,
  getSignFilterFinalLine,
} from "./signCatalog.js";
export type { SignFilterId, SignDatabaseSection, SignFilter, SignFilterLine } from "./signCatalog.js";