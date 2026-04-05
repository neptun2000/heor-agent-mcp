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
    "Search PubMed, ClinicalTrials.gov, bioRxiv/medRxiv, and ChEMBL for evidence on a drug or indication. Returns structured results with a full audit trail suitable for HTA submissions.",
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
          ],
        },
        description:
          "Data sources to query. Default: pubmed, clinicaltrials, biorxiv, chembl (+ embase if ELSEVIER_API_KEY set). Use 'who_gho' and 'world_bank' for epidemiology and demographic data. Use 'oecd' for OECD health statistics (expenditure, hospital beds, physicians, life expectancy). Use 'ihme_gbd' for Global Burden of Disease estimates (DALYs, prevalence, mortality across 204 countries).",
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
