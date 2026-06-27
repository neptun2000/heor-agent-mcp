import type { Database, FilterBlock } from "../../search/types.js";
import { SIGN_PAGE_URL } from "./signCatalog.js";

export type AgeLimitGroup = "pediatric" | "adult" | "elderly";

const PEDIATRIC_EMBASE =
  "baby:ab,ti OR babies:ab,ti OR newborn*:ab,ti OR neonat*:ab,ti OR toddler*:ab,ti OR child*:ab,ti OR preschool*:ab,ti OR schoolchild*:ab,ti OR boy*:ab,ti OR girl*:ab,ti OR 'pre school*':ab,ti OR pediatr*:ab,ti OR paediatr*:ab,ti OR prematur*:ab,ti OR 'pre matur*':ab,ti OR preterm*:ab,ti OR 'pre term*':ab,ti OR 'pre-term*':ab,ti OR nursery*:ab,ti OR 'child'/exp OR 'newborn'/exp OR 'infant'/exp OR 'preschool'/exp OR 'school'/exp OR 'adolescent'/exp OR 'child'/syn OR 'newborn'/syn OR 'infant'/syn OR 'preschool'/syn OR 'school'/syn OR 'adolescent'/syn OR teen*:ab,ti OR adolescent*:ab,ti OR infant*:ab,ti OR school*:ab,ti";

const PEDIATRIC_PUBMED =
  "(infant[mh] OR child[mh] OR adolescent[mh] OR pediatrics[mh] OR child[tiab] OR infant[tiab] OR adolescent[tiab] OR pediatric[tiab] OR paediatric[tiab] OR newborn[tiab] OR neonat*[tiab])";

const ADULT_EMBASE =
  "(adult:ab,ti OR adults:ab,ti OR 'adult'/exp OR 'adult'/syn OR 'middle aged'/exp OR 'middle aged':ab,ti)";

const ADULT_PUBMED =
  "(adult[mh] OR middle aged[mh] OR adult[tiab] OR adults[tiab])";

const ELDERLY_EMBASE =
  "(elderly:ab,ti OR aged:ab,ti OR 'aged'/exp OR 'aged'/syn OR geriatr*:ab,ti OR 'old age':ab,ti OR senior*:ab,ti)";

const ELDERLY_PUBMED =
  "(aged[mh] OR aged, 80 and over[mh] OR elderly[tiab] OR geriatric*[tiab])";

const AGE_LIMITS: Record<AgeLimitGroup, Record<Database, FilterBlock>> = {
  pediatric: {
    embase: {
      id: "age-pediatric-embase",
      database: "embase",
      lines: [PEDIATRIC_EMBASE],
      provenance: {
        source: "Pediatric population filter (design-log #44 fixture #8)",
        url: SIGN_PAGE_URL,
        citation: "HEORAgent validated Embase strategy — Fixture 1/2 pediatric age limit.",
      },
    },
    pubmed: {
      id: "age-pediatric-pubmed",
      database: "pubmed",
      lines: [PEDIATRIC_PUBMED],
      provenance: {
        source: "Pediatric population filter (PubMed translation)",
        url: SIGN_PAGE_URL,
        citation: "PubMed/MEDLINE translation of design-log #44 pediatric age limit.",
      },
    },
  },
  adult: {
    embase: {
      id: "age-adult-embase",
      database: "embase",
      lines: [ADULT_EMBASE],
      provenance: {
        source: "Adult population filter",
        url: SIGN_PAGE_URL,
        citation: "Standard adult age filter for Embase strategies.",
      },
    },
    pubmed: {
      id: "age-adult-pubmed",
      database: "pubmed",
      lines: [ADULT_PUBMED],
      provenance: {
        source: "Adult population filter (PubMed)",
        url: SIGN_PAGE_URL,
        citation: "Standard adult age filter for PubMed/MEDLINE strategies.",
      },
    },
  },
  elderly: {
    embase: {
      id: "age-elderly-embase",
      database: "embase",
      lines: [ELDERLY_EMBASE],
      provenance: {
        source: "Elderly population filter",
        url: SIGN_PAGE_URL,
        citation: "Standard elderly age filter for Embase strategies.",
      },
    },
    pubmed: {
      id: "age-elderly-pubmed",
      database: "pubmed",
      lines: [ELDERLY_PUBMED],
      provenance: {
        source: "Elderly population filter (PubMed)",
        url: SIGN_PAGE_URL,
        citation: "Standard elderly age filter for PubMed/MEDLINE strategies.",
      },
    },
  },
};

export function getAgeLimit(group: AgeLimitGroup, database: Database): FilterBlock {
  return AGE_LIMITS[group][database];
}