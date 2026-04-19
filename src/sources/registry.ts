import type { DataSource } from "../providers/types.js";

export interface SourceMeta {
  id: DataSource;
  name: string;
  category: SourceCategory;
  description: string;
  requiresKey?: string; // env var name if enterprise
  regional?: string; // geographic focus if applicable
}

export type SourceCategory =
  | "biomedical"
  | "clinical_trials"
  | "epidemiology"
  | "fda"
  | "enterprise"
  | "hta_cost"
  | "hta_appraisal"
  | "latam"
  | "apac"
  | "other";

export const SOURCE_REGISTRY: SourceMeta[] = [
  // Biomedical
  {
    id: "pubmed",
    name: "PubMed",
    category: "biomedical",
    description: "Biomedical literature (NLM/NIH)",
  },
  {
    id: "biorxiv",
    name: "bioRxiv/medRxiv",
    category: "biomedical",
    description: "Preprint server for bio/med sciences",
  },
  {
    id: "chembl",
    name: "ChEMBL",
    category: "biomedical",
    description: "Bioactive molecules and drug-like compounds",
  },

  // Clinical trials
  {
    id: "clinicaltrials",
    name: "ClinicalTrials.gov",
    category: "clinical_trials",
    description: "NIH/NLM clinical trial registry",
  },

  // Epidemiology
  {
    id: "who_gho",
    name: "WHO GHO",
    category: "epidemiology",
    description: "WHO Global Health Observatory",
  },
  {
    id: "world_bank",
    name: "World Bank",
    category: "epidemiology",
    description: "Health expenditure and demographic data",
  },
  {
    id: "all_of_us",
    name: "All of Us",
    category: "epidemiology",
    description: "NIH precision medicine cohort",
  },
  {
    id: "oecd",
    name: "OECD Health",
    category: "epidemiology",
    description: "OECD health statistics (expenditure, workforce)",
  },
  {
    id: "ihme_gbd",
    name: "IHME GBD",
    category: "epidemiology",
    description: "Global Burden of Disease (DALYs, prevalence)",
  },

  // FDA
  {
    id: "orange_book",
    name: "FDA Orange Book",
    category: "fda",
    description: "Drug approvals and therapeutic equivalence",
  },
  {
    id: "purple_book",
    name: "FDA Purple Book",
    category: "fda",
    description: "Licensed biologics and biosimilars",
  },

  // Enterprise (require API keys)
  {
    id: "embase",
    name: "Embase",
    category: "enterprise",
    description: "Elsevier biomedical database",
    requiresKey: "ELSEVIER_API_KEY",
  },
  {
    id: "sciencedirect",
    name: "ScienceDirect",
    category: "enterprise",
    description: "Elsevier full-text scientific articles and journals",
    requiresKey: "ELSEVIER_API_KEY",
  },
  {
    id: "cochrane",
    name: "Cochrane Library",
    category: "enterprise",
    description: "Systematic reviews and meta-analyses",
    requiresKey: "COCHRANE_API_KEY",
  },
  {
    id: "citeline",
    name: "Citeline",
    category: "enterprise",
    description: "Pharma intelligence platform",
    requiresKey: "CITELINE_API_KEY",
  },
  {
    id: "pharmapendium",
    name: "Pharmapendium",
    category: "enterprise",
    description: "Drug safety and ADME data",
    requiresKey: "PHARMAPENDIUM_API_KEY",
  },
  {
    id: "cortellis",
    name: "Cortellis",
    category: "enterprise",
    description: "Competitive intelligence and pipeline data",
    requiresKey: "CORTELLIS_API_KEY",
  },
  {
    id: "google_scholar",
    name: "Google Scholar",
    category: "enterprise",
    description: "Academic search engine",
    requiresKey: "SERPAPI_KEY",
  },

  // HTA cost references
  {
    id: "cms_nadac",
    name: "CMS NADAC",
    category: "hta_cost",
    description: "US drug acquisition costs (CMS API)",
    regional: "US",
  },
  {
    id: "pssru",
    name: "PSSRU",
    category: "hta_cost",
    description: "UK unit costs of health and social care",
    regional: "UK",
  },
  {
    id: "nhs_costs",
    name: "NHS Costs",
    category: "hta_cost",
    description: "NHS National Cost Collection",
    regional: "UK",
  },
  {
    id: "bnf",
    name: "BNF",
    category: "hta_cost",
    description: "British National Formulary drug pricing",
    regional: "UK",
  },
  {
    id: "pbs_schedule",
    name: "PBS Schedule",
    category: "hta_cost",
    description: "Australia PBS/MBS pricing",
    regional: "Australia",
  },

  // HTA appraisals
  {
    id: "nice_ta",
    name: "NICE TAs",
    category: "hta_appraisal",
    description: "NICE Technology Appraisals (UK)",
    regional: "UK",
  },
  {
    id: "cadth_reviews",
    name: "CDA-AMC (CADTH)",
    category: "hta_appraisal",
    description: "CDA-AMC (formerly CADTH) reimbursement reviews (Canada)",
    regional: "Canada",
  },
  {
    id: "icer_reports",
    name: "ICER",
    category: "hta_appraisal",
    description: "ICER evidence reports and HBPBs (US)",
    regional: "US",
  },
  {
    id: "pbac_psd",
    name: "PBAC",
    category: "hta_appraisal",
    description: "PBAC Public Summary Documents (Australia)",
    regional: "Australia",
  },
  {
    id: "gba_decisions",
    name: "G-BA",
    category: "hta_appraisal",
    description: "G-BA AMNOG benefit assessments (Germany)",
    regional: "Germany",
  },
  {
    id: "has_tc",
    name: "HAS",
    category: "hta_appraisal",
    description: "HAS Transparency Committee (France)",
    regional: "France",
  },
  {
    id: "iqwig",
    name: "IQWiG",
    category: "hta_appraisal",
    description: "IQWiG dossier assessments (Germany)",
    regional: "Germany",
  },
  {
    id: "aifa",
    name: "AIFA",
    category: "hta_appraisal",
    description: "AIFA reimbursement decisions (Italy)",
    regional: "Italy",
  },
  {
    id: "tlv",
    name: "TLV",
    category: "hta_appraisal",
    description: "TLV pricing decisions (Sweden)",
    regional: "Sweden",
  },
  {
    id: "inesss",
    name: "INESSS",
    category: "hta_appraisal",
    description: "INESSS drug evaluations (Quebec)",
    regional: "Canada",
  },

  // LATAM
  {
    id: "datasus",
    name: "DATASUS",
    category: "latam",
    description: "Brazil SUS hospital/ambulatory data",
    regional: "Brazil",
  },
  {
    id: "conitec",
    name: "CONITEC",
    category: "latam",
    description: "Brazil HTA reports",
    regional: "Brazil",
  },
  {
    id: "anvisa",
    name: "ANVISA",
    category: "latam",
    description: "Brazil drug pricing/registry",
    regional: "Brazil",
  },
  {
    id: "paho",
    name: "PAHO",
    category: "latam",
    description: "Pan American regional health statistics",
    regional: "LATAM",
  },
  {
    id: "iets",
    name: "IETS",
    category: "latam",
    description: "Colombia HTA reports",
    regional: "Colombia",
  },
  {
    id: "fonasa",
    name: "FONASA",
    category: "latam",
    description: "Chile public health insurance data",
    regional: "Chile",
  },

  // APAC
  {
    id: "hitap",
    name: "HITAP",
    category: "apac",
    description: "Thailand HTA reports",
    regional: "Thailand",
  },

  // Other
  {
    id: "ispor",
    name: "ISPOR",
    category: "other",
    description: "HEOR methodology and conference abstracts",
  },
  {
    id: "wiley",
    name: "Wiley Online Library",
    category: "biomedical",
    description:
      "Pharmacoeconomics, Health Economics, Journal of Medical Economics, Value in Health (via CrossRef — ~77% abstract coverage)",
  },
];

export interface SourceSelectionEntry {
  source: DataSource;
  name: string;
  category: SourceCategory;
  used: boolean;
  reason: string;
}

export function buildSourceSelectionTable(
  requestedSources: DataSource[],
  allSources: DataSource[] = SOURCE_REGISTRY.map((s) => s.id),
): SourceSelectionEntry[] {
  return allSources.map((sourceId) => {
    const meta = SOURCE_REGISTRY.find((s) => s.id === sourceId);
    const used = requestedSources.includes(sourceId);

    let reason: string;
    if (used) {
      reason = "Included in search";
    } else if (meta?.requiresKey && !process.env[meta.requiresKey]) {
      reason = `Not requested (requires ${meta.requiresKey})`;
    } else {
      reason = "Not requested by caller";
    }

    return {
      source: sourceId,
      name: meta?.name ?? sourceId,
      category: meta?.category ?? "other",
      used,
      reason,
    };
  });
}
