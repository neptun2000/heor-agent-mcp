import type { Database, FilterBlock } from "../../search/types.js";
import { SIGN_PAGE_URL } from "./signCatalog.js";

const EXCLUSION_EMBASE_SINGLE =
  "'case study':it OR 'case report':it OR 'abstract report':it OR 'editorial':it OR 'letter':it OR 'note':it OR 'case study'/exp OR 'case report'/exp OR 'abstract report'/exp OR 'editorial'/exp OR 'letter'/exp OR 'note'/exp OR ('animal'/exp NOT ('animal'/exp AND 'human'/exp)) OR ((review:it OR 'review literature as topic'/exp OR 'literature review':it) NOT ('meta-analysis':it OR 'meta-analysis as topic'/mj OR 'systematic review':ti OR 'systematic literature review':ti OR 'meta-analysis':ab,ti OR 'meta analysis':ab,ti))";

const EXCLUSION_PUBMED =
  '(case report[pt] OR letter[pt] OR editorial[pt] OR comment[pt] OR "historical article"[pt] OR animals[mh] NOT humans[mh])';

const EXCLUSION_EMBASE_MULTI = [
  "letter:it OR editorial:it OR note:it OR 'conference abstract':it",
  "(review:it OR 'review literature as topic'/exp OR 'literature review':ti) NOT ('meta-analysis':it OR 'meta-analysis as topic'/mj OR 'systematic review':ti OR 'systematic literature review':ti OR 'meta-analysis':ab,ti OR 'meta analysis':ab,ti)",
  "'animal'/exp NOT ('animal'/exp AND 'human'/exp)",
  "'case report'/exp OR 'case report*':ab,ti OR 'case series':ab,ti",
];

export const exclusionEmbaseSingle: FilterBlock = {
  id: "exclusion-embase-single",
  database: "embase",
  lines: [EXCLUSION_EMBASE_SINGLE],
  provenance: {
    source: "Study-design / publication-type exclusion (design-log #44 fixture)",
    url: SIGN_PAGE_URL,
    citation: "HEORAgent validated Embase strategy — Fixture 1 #6.",
  },
};

export const exclusionEmbaseMulti: FilterBlock = {
  id: "exclusion-embase-multi",
  database: "embase",
  lines: EXCLUSION_EMBASE_MULTI,
  provenance: {
    source: "Study-design / publication-type exclusion (design-log #44 fixture)",
    url: SIGN_PAGE_URL,
    citation: "HEORAgent validated Embase strategy — Fixture 3 #13–#16.",
  },
};

export const exclusionPubmed: FilterBlock = {
  id: "exclusion-pubmed",
  database: "pubmed",
  lines: [EXCLUSION_PUBMED],
  provenance: {
    source: "Publication-type / animal exclusion (PubMed translation)",
    url: SIGN_PAGE_URL,
    citation:
      "Adapted from SIGN RCT filter exclusion lines and design-log #44 fixture exclusions.",
  },
};

export function getExclusionFilter(
  database: Database,
  multiLine = false,
): FilterBlock {
  if (database === "pubmed") {
    return exclusionPubmed;
  }
  return multiLine ? exclusionEmbaseMulti : exclusionEmbaseSingle;
}