import { z } from "zod";
import { createProvider } from "../providers/factory.js";
import type { ToolResult } from "../providers/types.js";

const LiteratureSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  sources: z
    .array(
      z.enum([
        "pubmed",
        "clinicaltrials",
        "biorxiv",
        "chembl",
        "embase",
        "who_gho",
        "world_bank",
        "all_of_us",
        "oecd",
        "ihme_gbd",
        "orange_book",
        "purple_book",
        "cochrane",
        "citeline",
        "pharmapendium",
        "cortellis",
        "google_scholar",
        "cms_nadac",
        "pssru",
        "nhs_costs",
        "bnf",
        "pbs_schedule",
        "datasus",
        "conitec",
        "anvisa",
        "paho",
        "iets",
        "fonasa",
        "hitap",
      ]),
    )
    .optional(),
  max_results: z.number().int().min(1).max(100).optional(),
  date_from: z.string().optional(),
  study_types: z
    .array(z.enum(["rct", "meta_analysis", "observational", "review"]))
    .optional(),
  output_format: z.enum(["text", "json", "docx"]).optional(),
  project: z.string().optional(),
});

export async function handleLiteratureSearch(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = LiteratureSearchSchema.parse(rawParams);
  const provider = createProvider();
  return provider.searchLiterature(params);
}

export const literatureSearchToolSchema = {
  name: "literature_search",
  description:
    "Search PubMed, ClinicalTrials.gov, bioRxiv/medRxiv, ChEMBL, FDA Orange Book, FDA Purple Book, enterprise sources (Cochrane, Citeline, Pharmapendium, Cortellis), HTA cost reference sources (CMS NADAC, PSSRU, NHS National Cost Collection, BNF, PBS Schedule), LATAM sources (DATASUS, CONITEC, ANVISA, PAHO, IETS, FONASA), and APAC sources (HITAP) for evidence on a drug or indication. Returns structured results with a full audit trail suitable for HTA submissions.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Research question (e.g. 'semaglutide type 2 diabetes cost-effectiveness')",
      },
      sources: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "pubmed",
            "clinicaltrials",
            "biorxiv",
            "chembl",
            "embase",
            "who_gho",
            "world_bank",
            "all_of_us",
            "oecd",
            "ihme_gbd",
            "orange_book",
            "purple_book",
            "cochrane",
            "citeline",
            "pharmapendium",
            "cortellis",
            "google_scholar",
            "cms_nadac",
            "pssru",
            "nhs_costs",
            "bnf",
            "pbs_schedule",
            "datasus",
            "conitec",
            "anvisa",
            "paho",
            "iets",
            "fonasa",
            "hitap",
          ],
        },
        description:
          "Data sources to query. Default: pubmed, clinicaltrials, biorxiv, chembl (+ embase if ELSEVIER_API_KEY set). Use 'who_gho' and 'world_bank' for epidemiology and demographic data. Use 'oecd' for OECD health statistics (expenditure, hospital beds, physicians, life expectancy). Use 'ihme_gbd' for Global Burden of Disease estimates (DALYs, prevalence, mortality across 204 countries). Use 'orange_book' for FDA drug approvals and therapeutic equivalence. Use 'purple_book' for FDA-licensed biologics and biosimilars. Enterprise (require API key): 'cochrane' (COCHRANE_API_KEY), 'citeline' (CITELINE_API_KEY), 'pharmapendium' (PHARMAPENDIUM_API_KEY), 'cortellis' (CORTELLIS_API_KEY). HTA cost reference sources: 'cms_nadac' (US drug acquisition costs via CMS API), 'pssru' (UK unit costs, reference links), 'nhs_costs' (NHS National Cost Collection, reference links), 'bnf' (UK drug pricing, reference links), 'pbs_schedule' (Australia PBS/MBS pricing, reference links). LATAM sources (explicit request only): 'datasus' (Brazil SUS hospital/ambulatory data), 'conitec' (Brazil HTA reports), 'anvisa' (Brazil drug pricing/registry), 'paho' (Pan American regional health statistics), 'iets' (Colombia HTA reports), 'fonasa' (Chile public health insurance data). APAC sources (explicit request only): 'hitap' (Thailand HTA reports and methodology).",
      },
      max_results: {
        type: "number",
        description: "Maximum results to return (default: 20, max: 100)",
      },
      date_from: {
        type: "string",
        description:
          "Exclude results before this date (ISO format: YYYY-MM-DD)",
      },
      output_format: {
        type: "string",
        enum: ["text", "json", "docx"],
        description: "Output format. 'docx' requires hosted tier.",
      },
      project: {
        type: "string",
        description:
          "Project ID for knowledge base persistence. When set, results are saved to ~/.heor-agent/projects/{project}/raw/literature/",
      },
    },
    required: ["query"],
  },
};
